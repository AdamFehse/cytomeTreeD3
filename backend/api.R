library(plumber)
library(cytometree)
library(IFC)
library(jsonlite)

# Extract biological marker names from FCS file metadata
# Returns mapping of detector names to biological marker names
extract_marker_metadata <- function(fcs_description) {
  marker_map <- list()

  # FCS standard: $P1N, $P2N... = detector names (FL1-H, SSC-A, etc.)
  #               $P1S, $P2S... = biological marker names (CD20, CD23, etc.)

  # Find all parameter indices ($P1N, $P2N, etc.)
  param_keys <- grep("^\\$P[0-9]+N$", names(fcs_description), value = TRUE)

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
  marker_ranges <- list()
  for (marker in markers) {
    if (marker %in% colnames(data)) {
      marker_ranges[[marker]] <- list(
        min = round(min(data[, marker], na.rm = TRUE), 2),
        max = round(max(data[, marker], na.rm = TRUE), 2)
      )
    }
  }
  return(marker_ranges)
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

#* @post /analyze-batch
#* @parser json
function(req, res) {
  tryCatch({
    body <- req$body

    t <- body$t %||% 0.1
    files_data <- body$files

    if (is.null(files_data) || length(files_data) == 0) {
      stop("No files provided")
    }


    # Load and combine all files (each file should have base64 encoded content)
    all_data <- NULL
    fcs_metadata <- NULL  # Will store marker metadata from first file

    # Handle data.frame or list format
    num_files <- if (is.data.frame(files_data)) nrow(files_data) else length(files_data)

    for (i in 1:num_files) {

      # Extract file info from data.frame row
      if (is.data.frame(files_data)) {
        file_name <- files_data[i, "name"]
        file_content <- files_data[i, "content"]
      } else {
        file_name <- files_data[[i]]$name
        file_content <- files_data[[i]]$content
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

        if (is.null(all_data)) {
          all_data <- fcs_data
        } else {
          all_data <- rbind(all_data, fcs_data)
        }
      }
    }

    if (is.null(all_data)) {
      stop("No valid file data found")
    }


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
        # If no requested markers found, use all
        data <- as.numeric(as.matrix(all_data))
        dim(data) <- dim(all_data)
        colnames(data) <- colnames(all_data)
        markers <- colnames(data)
      }
    } else {
      # Use all markers
      data <- as.numeric(as.matrix(all_data))
      dim(data) <- dim(all_data)
      colnames(data) <- colnames(all_data)
      markers <- colnames(data)
    }

    # Extract marker ranges for coordinate space understanding (LLM context)
    marker_ranges <- extract_marker_ranges(data, markers)

    tree <- CytomeTree(data, t = as.numeric(t), verbose = FALSE)

    # Build gating tree (binary) for visualization, guard against 1D mark_tree
    tree_nodes <- list()
    tree_links <- list()
    tree_node_id <- 0
    mark_tree <- tree$mark_tree

    if (!is.null(mark_tree) && length(dim(mark_tree)) == 2 && nrow(mark_tree) > 0 && ncol(mark_tree) >= 5) {
      build_node_with_ids <- function(idx) {
        tree_node_id <<- tree_node_id + 1
        current_id <- tree_node_id

        row <- which(mark_tree[, 1] == idx)
        if (length(row) == 0) {
          # Leaf node
          cells_in_pop <- sum(tree$labels == idx)
          tree_nodes[[current_id]] <<- list(
            id = current_id,
            name = paste0("Pop_", idx),
            marker = paste0("Pop_", idx),
            cells = cells_in_pop
          )
          return(current_id)
        }

        # Internal node
        r <- mark_tree[row[1], ]
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

    # Get annotation with marker combinations
    annot <- Annotation(tree, plot = FALSE)
    annot_combinations <- annot$combinations

    nodes <- list()
    node_id <- 0

    # Create a node for each unique population
    for (pop_id in sort(unique(tree$labels))) {
      node_id <- node_id + 1
      cells_in_pop <- sum(tree$labels == pop_id)

      # Find annotation for this population
      annot_row <- which(annot_combinations$labels == pop_id)
      phenotype_str <- paste0("Pop_", pop_id)

      if (length(annot_row) > 0) {
        row_data <- annot_combinations[annot_row[1], ]
        phenotype_parts <- c()

        for (m in colnames(annot_combinations)) {
          if (m %in% markers && !is.na(row_data[[m]])) {
            marker_val <- row_data[[m]]
            if (marker_val == 1) {
              phenotype_parts <- c(phenotype_parts, paste0(m, "+"))
            } else if (marker_val == 0) {
              phenotype_parts <- c(phenotype_parts, paste0(m, "-"))
            }
          }
        }

        if (length(phenotype_parts) > 0) {
          phenotype_str <- paste(phenotype_parts, collapse = " ")
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

    # Send all marker values for each cell so frontend can compute any scatter plot
    cell_data <- lapply(sample_indices, function(cell_idx) {
      c(
        list(population = as.integer(tree$labels[cell_idx])),
        setNames(as.list(data[cell_idx, ]), markers)
      )
    })

    # Use first two markers for initial display
    marker_x <- markers[1]
    marker_y <- if (length(markers) > 1) markers[2] else markers[1]

    # Build phenotype list from annotations
    phenotypes_list <- list()
    for (i in 1:nrow(annot_combinations)) {
      row_data <- annot_combinations[i, ]
      pop_label <- row_data$labels
      phenotype_parts <- c()

      for (m in colnames(annot_combinations)) {
        if (m %in% markers && !is.na(row_data[[m]])) {
          marker_val <- row_data[[m]]
          if (marker_val == 1) {
            phenotype_parts <- c(phenotype_parts, paste0(m, "=1"))
          } else if (marker_val == 0) {
            phenotype_parts <- c(phenotype_parts, paste0(m, "=0"))
          }
        }
      }

      if (length(phenotype_parts) > 0) {
        phenotype_key <- paste(phenotype_parts, collapse = ",")
        phenotypes_list[[length(phenotypes_list) + 1]] <- list(
          key = phenotype_key,
          label = paste(phenotype_parts, collapse = " "),
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
      markerMappings = fcs_metadata %||% list(),  # Add marker metadata (empty if not available)
      markerRanges = marker_ranges,  # Marker intensity ranges for coordinate space understanding
      cellData = cell_data,
      cellDataMarkers = list(x = marker_x, y = marker_y),
      phenotypes = phenotypes_list
    )
    res$setHeader("Content-Type", "application/json")
    res$body <- jsonlite::toJSON(result, auto_unbox = TRUE)
    return(res)
  }, error = function(e) {
    cat("ERROR in /analyze-batch:", conditionMessage(e), "\n")
    list(error = conditionMessage(e))
  })
}

#* @post /analyze
#* @parser multi
function(req, res) {
  tryCatch({
    t <- 0.1
    if (!is.null(req$body$t)) {
      t_val <- as.numeric(unlist(req$body$t))
      if (length(t_val) > 0 && !is.na(t_val[1])) {
        t <- t_val[1]
      }
    }

    # Get uploaded files - plumber returns raw file object with value field
    file_obj <- req$body$files

    if (is.null(file_obj)) {
      stop("No files provided")
    }


    # Check if there's a parsed field with multiple files
    if (!is.null(file_obj$parsed)) {
      if (is.list(file_obj$parsed)) {
      }
    }

    # Handle the file object - it has value (raw bytes), filename, content_type, etc
    filepath <- NULL

    if (!is.null(file_obj$value) && is.raw(file_obj$value)) {
      # Raw bytes from form data
      temp_file <- tempfile(fileext = ".fcs")
      writeBin(file_obj$value, temp_file)
      filepath <- temp_file
    } else if (!is.null(file_obj$datapath) && file.exists(file_obj$datapath)) {
      # Traditional datapath
      filepath <- file_obj$datapath
    } else {
      stop("No valid file content found")
    }

    fcs <- IFC::readFCS(fileName = filepath)
    fcs_data <- as.matrix(fcs[[1]]$data)
    all_data <- fcs_data


    # Get all marker names
    all_markers <- colnames(all_data)

    # Use all markers
    data <- all_data
    markers <- all_markers

    tree <- CytomeTree(data, t = as.numeric(t), verbose = FALSE)

    nodes <- list()
    links <- list()
    node_id <- 0

    build_node_with_ids <- function(idx) {
      node_id <<- node_id + 1
      current_id <- node_id

      row <- which(tree$mark_tree[, 1] == idx)
      if (length(row) == 0) {
        # Leaf node
        cells_in_pop <- sum(tree$labels == idx)
        nodes[[current_id]] <<- list(
          id = current_id,
          name = paste0("Pop_", idx),
          marker = paste0("Pop_", idx),
          cells = cells_in_pop
        )
        return(current_id)
      }

      # Internal node
      r <- tree$mark_tree[row[1], ]
      marker_name <- if (r[2] <= length(markers)) markers[r[2]] else paste0("Marker_", r[2])

      nodes[[current_id]] <<- list(
        id = current_id,
        name = paste0("Node_", idx),
        marker = marker_name,
        threshold = round(r[3], 2)
      )

      # Recursively build children
      left_id <- build_node_with_ids(r[4])
      right_id <- build_node_with_ids(r[5])

      # Create links to children
      links[[length(links) + 1]] <<- list(source = current_id, target = left_id)
      links[[length(links) + 1]] <<- list(source = current_id, target = right_id)

      return(current_id)
    }

    build_node_with_ids(1)

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

    # Convert links to proper format
    links_clean <- lapply(links, function(link) {
      list(
        source = as.integer(link$source),
        target = as.integer(link$target)
      )
    })

    result <- list(
      nodes = nodes_clean,
      links = links_clean,
      populations = length(unique(tree$labels)),
      cells = nrow(data)
    )
    res$setHeader("Content-Type", "application/json")
    res$body <- jsonlite::toJSON(result, auto_unbox = TRUE)
    return(res)
  }, error = function(e) {
    cat("ERROR in /analyze:", conditionMessage(e), "\n")
    list(error = conditionMessage(e))
  })
}
