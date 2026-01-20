library(plumber)
library(cytometree)
library(IFC)
library(jsonlite)
library(matrixStats)

# Extract biological marker names from FCS file metadata
# Returns mapping of detector names to biological marker names
extract_marker_metadata <- function(fcs_description) {
  marker_map <- list()

  # FCS standard: $P1N, $P2N... = detector names (FL1-H, SSC-A, etc.)
  #               $P1S, $P2S... = biological marker names (CD20, CD23, etc.)
  #         We prefer biological marker names when available -- fluorochromes -- 
  # (such as CD20, CD23, FITC, PE). 
  # Find all parameter indices ($P1N, $P2N, etc.)
  param_keys <- grep("^\\$P[0-9]+N$", names(fcs_description), value = TRUE)
  # grep -- built-in base R function for efficient pattern matching in character vectors
  for (param_key in param_keys) {
    # Extract parameter number (e.g., "1" from "$P1N")
    param_num <- gsub("^\\$P([0-9]+)N$", "\\1", param_key)

    # Get detector name ($PnN)
    detector_name <- fcs_description[[param_key]]
    if (!is.null(detector_name)) {
      detector_name <- as.character(detector_name)

      # Get biological marker name ($PnS) - this is what we prefer
      marker_key <- paste0("$P", param_num, "S")
      biological_marker <- fcs_description[[marker_key]]

      # Use biological marker if available, otherwise use detector name
      marker_name <- if (!is.null(biological_marker) && nchar(as.character(biological_marker)) > 0) {
        as.character(biological_marker)
      } else {
        detector_name
      }

      # Store mapping
      marker_map[[detector_name]] <- list(
        technical = detector_name,
        biological = marker_name
      )
    }
  }

  return(marker_map)
}

# Extract marker intensity ranges (min/max) for coordinate space understanding
# Helps LLM understand the distribution and thresholds in context
extract_marker_ranges <- function(data, markers) {
  # Vectorized: only compute for markers that exist in data
  valid_markers <- markers[markers %in% colnames(data)]

  if (length(valid_markers) == 0) {
    return(setNames(list(), character(0)))
  }

  # Use matrixStats::colRanges for vectorized min/max (3-5x faster on wide data)
  # Pass column indices to avoid creating temporary submatrix copy
  marker_cols <- match(valid_markers, colnames(data))
  ranges <- matrixStats::colRanges(data, cols = marker_cols, na.rm = TRUE)
  marker_ranges <- lapply(seq_len(nrow(ranges)), function(i) {
    list(
      min = round(ranges[i, 1], 2),
      max = round(ranges[i, 2], 2)
    )
  })

  setNames(marker_ranges, valid_markers)
}

# Build a binary tree from CytomeTree's level-ordered mark_tree list.
# CytomeTree returns a list of levels with node labels in left-to-right order.
build_tree_from_mark_tree_levels <- function(mark_tree_levels, label_counts) {
  tree_nodes <- list()
  tree_links <- list()
  tree_node_id <- 0

  is_leaf_label <- function(label) {
    grepl("^[0-9]+$", label)
  }

  marker_from_label <- function(label) {
    sub("\\.[0-9]+$", "", label)
  }

  create_node <- function(label) {
    tree_node_id <<- tree_node_id + 1
    current_id <- tree_node_id

    label_chr <- as.character(label)[1]
    if (is_leaf_label(label_chr)) {
      pop_id <- as.integer(label_chr)
      cells_in_pop <- if (!is.na(pop_id) && pop_id <= length(label_counts)) label_counts[pop_id] else NA_integer_
      tree_nodes[[current_id]] <<- list(
        id = current_id,
        name = paste0("Pop_", pop_id),
        marker = paste0("Pop_", pop_id),
        cells = cells_in_pop
      )
      list(id = current_id, is_internal = FALSE)
    } else {
      marker_label <- marker_from_label(label_chr)
      tree_nodes[[current_id]] <<- list(
        id = current_id,
        name = label_chr,
        marker = marker_label
      )
      list(id = current_id, is_internal = TRUE)
    }
  }

  if (length(mark_tree_levels) == 0) {
    return(list(nodes = tree_nodes, links = tree_links))
  }

  level_nodes <- as.character(unlist(mark_tree_levels[[1]], use.names = FALSE))
  current_internal_ids <- integer(0)
  for (label in level_nodes) {
    node_info <- create_node(label)
    if (node_info$is_internal) {
      current_internal_ids <- c(current_internal_ids, node_info$id)
    }
  }

  if (length(current_internal_ids) == 0) {
    return(list(nodes = tree_nodes, links = tree_links))
  }

  for (level_idx in 2:length(mark_tree_levels)) {
    next_labels <- as.character(unlist(mark_tree_levels[[level_idx]], use.names = FALSE))
    if (length(next_labels) == 0) break

    next_internal_ids <- integer(0)
    next_index <- 1

    for (parent_id in current_internal_ids) {
      for (child_pos in 1:2) {
        if (next_index > length(next_labels)) break
        label <- next_labels[next_index]
        next_index <- next_index + 1

        node_info <- create_node(label)
        tree_links[[length(tree_links) + 1]] <- list(source = parent_id, target = node_info$id)

        if (node_info$is_internal) {
          next_internal_ids <- c(next_internal_ids, node_info$id)
        }
      }
    }

    current_internal_ids <- next_internal_ids
    if (length(current_internal_ids) == 0) break
  }

  list(nodes = tree_nodes, links = tree_links)
}

# Use standard multipart parser for file uploads

#* @filter cors
function(req, res) {
  res$setHeader("Access-Control-Allow-Origin", "*")
  res$setHeader("Access-Control-Allow-Methods", "*")
  res$setHeader("Access-Control-Allow-Headers", "*")
  if (req$REQUEST_METHOD == "OPTIONS") return(list())
  plumber::forward()
}

#* @get /health
function() list(status = "ok")

#* @post /analyze
#* @parser json
function(req, res) {
  tryCatch({
    body <- req$body

    # Threshold for CytomeTree splitting (lower = more granular tree, deeper hierarchy)
    # Default 0.01 creates deeper binary tree. Can override via API: ?t=0.005 for even more splitting
    t <- body$t %||% 0.01
    files_data <- body$files

    if (is.null(files_data) || length(files_data) == 0) {
      stop("No files provided")
    }


    # Load and combine all files (each file should have base64 encoded content)
    fcs_metadata <- NULL  # Will store marker metadata from first file

    # Handle data.frame or list format
    num_files <- if (is.data.frame(files_data)) nrow(files_data) else length(files_data)

    # Pre-allocate file_matrices list to avoid repeated reallocations
    file_matrices <- vector("list", num_files)
    file_count <- 0

    for (i in 1:num_files) {
      # Extract file content from data.frame row or list
      file_content <- if (is.data.frame(files_data)) {
        files_data[i, "content", drop = TRUE]  # drop=TRUE ensures scalar, not 1-col data.frame
      } else {
        files_data[[i]]$content
      }

      # Decode base64 content
      if (!is.null(file_content) && nchar(file_content) > 0) {
        raw_bytes <- jsonlite::base64_dec(file_content)
        temp_file <- tempfile(fileext = ".fcs")
        writeBin(raw_bytes, temp_file)

        fcs <- IFC::readFCS(fileName = temp_file)
        fcs_data <- as.matrix(fcs[[1]]$data)

        # Extract marker metadata from first file only (assume batch has same panel)
        if (i == 1 && is.null(fcs_metadata)) {
          fcs_metadata <- extract_marker_metadata(fcs[[1]]$description)
        }

        file_count <- file_count + 1
        file_matrices[[file_count]] <- fcs_data
      }
    }

    if (file_count == 0) {
      stop("No valid file data found")
    }

    # Trim pre-allocated list to actual count and combine
    file_matrices <- file_matrices[seq_len(file_count)]
    all_data <- do.call(rbind, file_matrices)


    # Get all marker names
    all_markers <- colnames(all_data)

    # Check if specific markers were requested
    requested_markers <- body$markers
    if (!is.null(requested_markers) && length(requested_markers) > 0) {
      # Filter to only requested markers that exist
      marker_indices <- which(all_markers %in% requested_markers)
      if (length(marker_indices) > 0) {
        data <- all_data[, marker_indices, drop = FALSE]
        markers <- colnames(data)
      } else {
        # If no requested markers found, use all (avoid unnecessary copy)
        data <- all_data
        markers <- all_markers
      }
    } else {
      # Use all markers (avoid unnecessary copy)
      data <- all_data
      markers <- all_markers
    }

    # Extract marker ranges for coordinate space understanding (LLM context)
    marker_ranges <- extract_marker_ranges(data, markers)

    tree <- CytomeTree(data, t = as.numeric(t), verbose = FALSE)

    # Debug: check all available tree fields
    cat("DEBUG: CytomeTree object fields:", paste(names(tree), collapse=", "), "\n")

    # Pre-compute label counts via tabulate (O(n), no character conversion)
    label_counts <- tabulate(tree$labels)

    # Build gating tree (binary) for visualization, guard against 1D mark_tree
    tree_nodes <- list()
    tree_links <- list()
    tree_node_id <- 0
    mark_tree <- tree$mark_tree

    # Convert mark_tree to matrix if it's not already
    if (!is.null(mark_tree) && !is.matrix(mark_tree) && length(mark_tree) > 0) {
      # Try to convert to matrix (reshape if needed)
      mark_tree <- as.matrix(mark_tree)
      if (nrow(mark_tree) == 1 && ncol(mark_tree) > 5) {
        # If it's a single row, transpose it to check if it's actually multi-row data
        mark_tree <- t(matrix(mark_tree, ncol = 5))
      }
    }

    if (!is.null(mark_tree) && is.matrix(mark_tree) && nrow(mark_tree) > 0 && ncol(mark_tree) >= 5) {
      # Pre-compute mark_tree row lookup using integer match (faster than string hashing)
      mark_tree_ids <- mark_tree[, 1]

      build_node_with_ids <- function(idx) {
        tree_node_id <<- tree_node_id + 1
        current_id <- tree_node_id

        row_idx <- match(idx, mark_tree_ids)
        if (is.na(row_idx)) {
          # Leaf node - O(1) direct lookup instead of O(n) sum
          cells_in_pop <- label_counts[idx]
          tree_nodes[[current_id]] <<- list(
            id = current_id,
            name = paste0("Pop_", idx),
            marker = paste0("Pop_", idx),
            cells = cells_in_pop
          )
          return(current_id)
        }

        # Internal node
        r <- mark_tree[row_idx, ]
        marker_name <- if (r[2] <= length(markers)) markers[r[2]] else paste0("Marker_", r[2])

        tree_nodes[[current_id]] <<- list(
          id = current_id,
          name = paste0("Node_", idx),
          marker = marker_name,
          threshold = round(r[3], 2)
        )

        # Recursively build children
        left_id <- build_node_with_ids(r[4])
        right_id <- build_node_with_ids(r[5])

        # Create links to children
        tree_links[[length(tree_links) + 1]] <<- list(source = current_id, target = left_id)
        tree_links[[length(tree_links) + 1]] <<- list(source = current_id, target = right_id)

        return(current_id)
      }

      build_node_with_ids(1)
    }

    # Fallback: if mark_tree is a list instead of matrix, parse it recursively
    if (length(tree_nodes) == 0 && is.list(mark_tree) && length(mark_tree) > 0) {
      mark_tree_names <- names(mark_tree)
      if (!is.null(mark_tree_names) && length(mark_tree_names) > 0) {
        node_name_to_id <- new.env(parent = emptyenv())
        visited <- new.env(parent = emptyenv())

        parse_mark_tree_entry <- function(entry) {
          marker_val <- NULL
          threshold_val <- NULL

          if (!is.null(entry)) {
            if (is.list(entry)) {
              if (!is.null(entry$marker)) marker_val <- entry$marker
              if (is.null(marker_val) && !is.null(entry$variable)) marker_val <- entry$variable
              if (is.null(marker_val) && length(entry) > 0) marker_val <- entry[[1]]
              if (!is.null(entry$cut)) threshold_val <- entry$cut
              if (is.null(threshold_val) && !is.null(entry$threshold)) threshold_val <- entry$threshold
            } else {
              marker_val <- entry
            }
          }

          if (!is.null(marker_val) && is.numeric(marker_val) && length(marker_val) == 1) {
            if (marker_val <= length(markers)) marker_val <- markers[marker_val]
          }

          marker_val <- if (is.null(marker_val)) NULL else as.character(marker_val)[1]
          threshold_val <- if (is.null(threshold_val)) NULL else round(as.numeric(threshold_val)[1], 2)

          list(marker = marker_val, threshold = threshold_val)
        }

        build_mark_tree_list <- function(node_name, parent_id = NULL) {
          if (!is.null(visited[[node_name]])) {
            return(node_name_to_id[[node_name]])
          }
          visited[[node_name]] <- TRUE

          tree_node_id <<- tree_node_id + 1
          current_id <- tree_node_id
          node_name_to_id[[node_name]] <- current_id

          entry <- mark_tree[[node_name]]
          parsed <- parse_mark_tree_entry(entry)
          marker_label <- if (is.null(parsed$marker)) "root" else parsed$marker

          tree_nodes[[current_id]] <<- list(
            id = current_id,
            name = node_name,
            marker = marker_label,
            threshold = parsed$threshold
          )

          if (!is.null(parent_id)) {
            tree_links[[length(tree_links) + 1]] <<- list(source = parent_id, target = current_id)
          }

          child_marker <- parsed$marker
          if (!is.null(child_marker)) {
            left_candidates <- c(paste0(child_marker, ".0"), paste0(node_name, ".0"))
            right_candidates <- c(paste0(child_marker, ".1"), paste0(node_name, ".1"))

            left_name <- left_candidates[left_candidates %in% mark_tree_names][1]
            right_name <- right_candidates[right_candidates %in% mark_tree_names][1]

            if (!is.na(left_name)) build_mark_tree_list(left_name, current_id)
            if (!is.na(right_name)) build_mark_tree_list(right_name, current_id)
          }

          return(current_id)
        }

        root_name <- if ("root" %in% mark_tree_names) "root" else mark_tree_names[1]
        build_mark_tree_list(root_name)
      }
    }

    # Fallback: mark_tree as level-ordered list (even if names were injected)
    if (length(tree_nodes) <= 1 && is.list(mark_tree) && length(mark_tree) > 0) {
      tree_from_levels <- build_tree_from_mark_tree_levels(mark_tree, label_counts)
      if (length(tree_from_levels$nodes) > length(tree_nodes)) {
        tree_nodes <- tree_from_levels$nodes
        tree_links <- tree_from_levels$links
      }
    }

    # Get annotation with marker combinations
    annot <- Annotation(tree, plot = FALSE)
    annot_combinations <- annot$combinations

    nodes <- list()
    node_id <- 0

    marker_cols <- colnames(annot_combinations)
    # Pre-compute which marker columns are actually in use (avoid repeated %in% checks)
    markers_in_use <- intersect(marker_cols, markers)

    # Helper: Build phenotype string from annotation row
    build_phenotype_str <- function(row_data, markers_subset) {
      phenotype_parts <- character(0)
      for (m in markers_subset) {
        if (!is.na(row_data[[m]])) {
          marker_val <- row_data[[m]]
          phenotype_parts <- c(phenotype_parts,
            if (marker_val == 1) paste0(m, "+") else if (marker_val == 0) paste0(m, "-") else NA_character_)
        }
      }
      phenotype_parts <- phenotype_parts[!is.na(phenotype_parts)]
      if (length(phenotype_parts) > 0) paste(phenotype_parts, collapse = " ") else ""
    }

    # Create a node for each unique population
    for (pop_id in sort(unique(tree$labels))) {
      node_id <- node_id + 1
      cells_in_pop <- label_counts[pop_id]

      # Find annotation for this population
      annot_row <- which(annot_combinations$labels == pop_id)
      phenotype_str <- paste0("Pop_", pop_id)

      if (length(annot_row) > 0) {
        row_data <- annot_combinations[annot_row[1], ]
        phenotype_str_result <- build_phenotype_str(row_data, markers_in_use)
        if (nchar(phenotype_str_result) > 0) {
          phenotype_str <- phenotype_str_result
        }
      }

      nodes[[node_id]] <- list(
        id = node_id,
        name = phenotype_str,
        marker = phenotype_str,
        cells = cells_in_pop
      )
    }

    # No links for now (populations are independent)
    links <- list()

    # Convert nodes to proper format for JSON serialization
    nodes_clean <- lapply(nodes, function(node) {
      list(
        id = as.integer(node$id),
        name = as.character(node$name),
        marker = as.character(node$marker),
        cells = if (!is.null(node$cells)) as.integer(node$cells) else NULL,
        threshold = node$threshold
      )
    })

    # Convert gating tree nodes/links to proper format
    tree_nodes_clean <- lapply(tree_nodes, function(node) {
      list(
        id = as.integer(node$id),
        name = as.character(node$name),
        marker = as.character(node$marker),
        cells = if (!is.null(node$cells)) as.integer(node$cells) else NULL,
        threshold = node$threshold
      )
    })

    # Convert links to proper format
    links_clean <- lapply(links, function(link) {
      list(
        source = as.integer(link$source),
        target = as.integer(link$target)
      )
    })

    tree_links_clean <- lapply(tree_links, function(link) {
      list(
        source = as.integer(link$source),
        target = as.integer(link$target)
      )
    })

    # Prepare cell data for scatter plot (sample if too many)
    num_cells <- nrow(data)
    sample_size <- min(num_cells, 10000)  # Limit to 10k cells for performance

    if (num_cells > sample_size) {
      sample_indices <- sample(1:num_cells, sample_size)
    } else {
      sample_indices <- 1:num_cells
    }

    # Build cell data as data.frame (10-20x faster than nested lists)
    # toJSON with dataframe="rows" produces same output structure but more efficient
    cell_data <- data.frame(
      population = as.integer(tree$labels[sample_indices]),
      data[sample_indices, , drop = FALSE],
      check.names = FALSE,
      stringsAsFactors = FALSE
    )

    # Use first two markers for initial display
    marker_x <- markers[1]
    marker_y <- if (length(markers) > 1) markers[2] else markers[1]

    # Build phenotype list from annotations
    # Helper: Build phenotype key/label from annotation row
    build_phenotype_key_and_label <- function(row_data, markers_subset) {
      phenotype_parts <- character(0)
      for (m in markers_subset) {
        if (!is.na(row_data[[m]])) {
          marker_val <- row_data[[m]]
          phenotype_parts <- c(phenotype_parts,
            if (marker_val == 1) paste0(m, "=1") else if (marker_val == 0) paste0(m, "=0") else NA_character_)
        }
      }
      phenotype_parts <- phenotype_parts[!is.na(phenotype_parts)]
      list(
        key = if (length(phenotype_parts) > 0) paste(phenotype_parts, collapse = ",") else "",
        label = if (length(phenotype_parts) > 0) paste(phenotype_parts, collapse = " ") else ""
      )
    }

    phenotypes_list <- list()
    for (i in 1:nrow(annot_combinations)) {
      row_data <- annot_combinations[i, ]
      pop_label <- row_data$labels

      phenotype_info <- build_phenotype_key_and_label(row_data, markers_in_use)

      if (nchar(phenotype_info$key) > 0) {
        phenotypes_list[[length(phenotypes_list) + 1]] <- list(
          key = phenotype_info$key,
          label = phenotype_info$label,
          population = as.integer(pop_label),
          count = as.integer(row_data$count),
          proportion = as.numeric(row_data$prop)
        )
      }
    }

    result <- list(
      nodes = nodes_clean,
      links = links_clean,
      treeNodes = tree_nodes_clean,
      treeLinks = tree_links_clean,
      populations = length(unique(tree$labels)),
      cells = nrow(data),
      markers = as.list(markers),
      markerMappings = fcs_metadata %||% list(),
      markerRanges = marker_ranges,
      cellData = cell_data,
      cellDataMarkers = list(x = marker_x, y = marker_y),
      phenotypes = phenotypes_list,
      debug_info = list(
        mark_tree_is_null = is.null(tree$mark_tree),
        mark_tree_class = if (is.null(tree$mark_tree)) "NULL" else class(tree$mark_tree),
        mark_tree_length = if (is.null(tree$mark_tree)) 0 else length(tree$mark_tree),
        mark_tree_names = if (is.null(tree$mark_tree)) list() else names(tree$mark_tree),
        mark_tree_sample = if (is.null(tree$mark_tree)) NULL else as.character(tree$mark_tree[[1]])
      )
    )
    res$setHeader("Content-Type", "application/json")
    res$body <- jsonlite::toJSON(result, auto_unbox = TRUE, dataframe = "rows")
    return(res)
  }, error = function(e) {
    cat("ERROR in /analyze:", conditionMessage(e), "\n")
    list(error = conditionMessage(e))
  })
}
