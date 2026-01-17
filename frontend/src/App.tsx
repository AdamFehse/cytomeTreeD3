import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import "./App.css";
import TreeViz from "./TreeViz";
import CellScatter from "./CellScatter";
import GatingOverview from "./GatingOverview";

const DEFAULT_WORKER = "https://cytomaitree.adamfehse.workers.dev/";

interface Phenotype {
  key: string;
  label: string;
  population: number;
  count: number;
  proportion: number;
}

interface TreeData {
  nodes: Array<{ id: number; name: string; marker: string; cells: number }>;
  links: Array<{ source: number; target: number }>;
  treeNodes?: Array<{
    id: number;
    name: string;
    marker: string;
    cells?: number;
    threshold?: number;
  }>;
  treeLinks?: Array<{ source: number; target: number }>;
  populations: number;
  cells: number;
  markers?: string[];
  markerMappings?: Record<string, { technical: string; biological: string }>;
  markerRanges?: Record<string, { min: number; max: number }>;
  cellData?: Array<{ x: number; y: number; population: number }>;
  cellDataMarkers?: { x: string; y: string };
  phenotypes?: Phenotype[];
}

interface LiteraturePaper {
  pmid: string;
  title: string;
  authors: string;
  pubdate?: string;
  source?: string;
  fullTextAvailable?: boolean;
  pmcId?: string | null;
  pubmedUrl?: string | null;
  pmcUrl?: string | null;
  pdfUrl?: string | null;
  excerpt?: string;
  why?: string;
  takeaway?: string;
}

interface LiteratureBucket {
  label: string;
  query: string;
  tier: "marker" | "phenotype" | "combined";
  papers: LiteraturePaper[];
}

interface LiteraturePayload {
  markers: LiteratureBucket[];
  phenotypes: LiteratureBucket[];
  combined: LiteratureBucket | null;
  queries?: Array<{ tier: string; label: string; query: string }>;
}

function App() {
  const [treeData, setTreeData] = useState<TreeData | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [threshold, setThreshold] = useState(0.1);
  const [selectedFiles, setSelectedFiles] = useState<FileList | null>(null);
  const [scatterXMarker, setScatterXMarker] = useState<string>("");
  const [scatterYMarker, setScatterYMarker] = useState<string>("");
  const [selectedPhenotype, setSelectedPhenotype] = useState<string | null>(
    null,
  );
  const [progress, setProgress] = useState(0);
  const [elapsedTime, setElapsedTime] = useState(0);
  const progressTimerRef = useRef<number | null>(null);
  const elapsedTimerRef = useRef<number | null>(null);
  const [aiModels, setAiModels] = useState<string[]>([]);
  const [aiModel, setAiModel] = useState<string>("");
  const [aiInsight, setAiInsight] = useState<Record<string, unknown> | null>(
    null,
  );
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiCitations, setAiCitations] = useState<Array<any>>([]);
  const [researchContext, setResearchContext] = useState<string>("");
  const [granularInsight, setGranularInsight] = useState<Record<
    string,
    unknown
  > | null>(null);
  const [granularLoading, setGranularLoading] = useState(false);
  const [selectedNodeId, setSelectedNodeId] = useState<number | null>(null);
  const [showGranularModal, setShowGranularModal] = useState(false);
  const [literatureTierFilter, setLiteratureTierFilter] = useState<
    "all" | "marker" | "phenotype" | "combined"
  >("all");
  const [fullTextOnly, setFullTextOnly] = useState(false);

  // Skip link functionality
  const skipToMainContent = () => {
    const mainContent = document.querySelector('main[role="main"]');
    if (mainContent) {
      mainContent.setAttribute("tabIndex", "-1");
      mainContent.addEventListener(
        "blur",
        () => {
          mainContent.removeAttribute("tabIndex");
        },
        { once: true },
      );
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSelectedFiles(e.target.files);
  };

  useEffect(() => {
    const controller = new AbortController();
    const loadModels = async () => {
      try {
        const response = await fetch(DEFAULT_WORKER, {
          signal: controller.signal,
        });
        if (!response.ok) return;
        const data = await response.json();
        const models = Array.isArray(data.allowed_models)
          ? data.allowed_models.filter(Boolean)
          : [];
        setAiModels(models);
        if (models.length > 0) {
          setAiModel((current) => current || models[0]);
        }
      } catch {
        // Ignore model load failures; AI can still be enabled later.
      }
    };
    loadModels();
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (
      !treeData ||
      aiModels.length === 0 ||
      aiLoading ||
      aiInsight ||
      aiError
    ) {
      return;
    }
    void runAiInsights(treeData);
  }, [aiModels, treeData, aiLoading, aiInsight, aiError]);

  const callWorker = async (
    prompt: string,
    model?: string,
    analysisMode?: "comprehensive" | "granular",
    nodeId?: number,
  ) => {
    try {
      const requestBody: any = { text: prompt, model };
      if (researchContext) requestBody.researchContext = researchContext;
      if (analysisMode) requestBody.analysisMode = analysisMode;
      if (nodeId !== undefined) requestBody.nodeId = nodeId;

      const requestStr = JSON.stringify(requestBody);
      const response = await fetch(DEFAULT_WORKER, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: requestStr,
      });

      if (!response.ok) {
        const body = await response.text().catch(() => "");
        console.error("AI request failed:", response.status, body);
        throw new Error(`AI request failed (${response.status}). ${body}`);
      }

      const text = await response.text();

      try {
        const parsed = JSON.parse(text);
        return parsed;
      } catch (e) {
        console.error(
          "JSON parse error. Response text:",
          text.substring(0, 500),
        );
        throw new Error(
          `Invalid JSON response from AI: ${e instanceof Error ? e.message : "Unknown error"}`,
        );
      }
    } catch (err) {
      throw err;
    }
  };

  const runGranularAnalysis = async (nodeId: number) => {
    setGranularLoading(true);
    setGranularInsight(null);
    setSelectedNodeId(nodeId);
    setShowGranularModal(true);

    try {
      if (!treeData || !aiModel) return;
      const phenotype = treeData.phenotypes?.find(
        (p) => p.population === nodeId,
      );
      if (!phenotype) {
        setGranularInsight({ error: "Phenotype not found" });
        return;
      }

      const payload = buildAiPayload(treeData);
      const result = await callWorker(
        JSON.stringify(payload),
        aiModel,
        "granular",
        nodeId,
      );
      setGranularInsight(result);
    } catch (error) {
      console.error("Granular analysis error:", error);
      setGranularInsight({ error: "Failed to analyze node" });
    } finally {
      setGranularLoading(false);
    }
  };

  const handleLeafNodeClick = (nodeId: number) => {
    // Verify node exists in phenotype data
    if (!treeData?.phenotypes) return;
    const node = treeData.phenotypes.find((p) => p.population === nodeId);
    if (!node) return;

    runGranularAnalysis(nodeId);
  };


  const buildAiPayload = (data: TreeData) => {
    const biologicalMarkers = data.markerMappings
      ? Object.values(data.markerMappings)
          .map((m) => m.biological)
          .filter((m) => m && !m.match(/^FL[0-9]/))
      : [];

    const payload = {
      summary: {
        total_cells: data.cells,
        populations: data.populations,
        markers: data.markers || [],
        biologicalMarkers: biologicalMarkers,
        markerMappings: data.markerMappings || {},
        markerRanges: data.markerRanges || {},
      },
      phenotypes: data.phenotypes ? data.phenotypes.slice(0, 80) : [],
    };

    return payload;
  };

  const runAiInsights = async (data: TreeData) => {
    if (aiModels.length === 0 || !aiModel) {
      return;
    }
    setAiLoading(true);
    setAiError(null);
    setAiInsight(null);
    setAiCitations([]);
    try {
      const payload = buildAiPayload(data);
      const result = await callWorker(
        JSON.stringify(payload),
        aiModel,
      );
      setAiInsight(result);
      if (result.citations && Array.isArray(result.citations)) {
        setAiCitations(result.citations);
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : "AI request failed";
      console.error("AI Insights error:", errorMsg);
      setAiError(errorMsg);
    } finally {
      setAiLoading(false);
    }
  };

  const renderAiList = (value: unknown) => {
    if (!Array.isArray(value) || value.length === 0) {
      return <p className="muted">Not observed.</p>;
    }
    return (
      <ul className="ai-list">
        {value.map((item, index) => (
          <li key={`item-${index}`} className="ai-list-item">
            {String(item)}
          </li>
        ))}
      </ul>
    );
  };

  const renderLiteraturePaper = (
    paper: LiteraturePaper,
    index: number,
    provenance: string,
  ) => (
    <article
      key={`${paper.pmid}-${index}`}
      className="literature-paper"
    >
      <div className="literature-paper-header">
        <div>
          <h4>{paper.title}</h4>
          <p className="muted">
            {paper.authors}
            {paper.pubdate ? ` • ${paper.pubdate}` : ""}
          </p>
        </div>
        <div className="literature-badges">
          {paper.fullTextAvailable ? (
            <span className="card-tag badge-fulltext">Full Text</span>
          ) : (
            <span className="card-tag badge-abstract">Abstract Only</span>
          )}
          {paper.pdfUrl && (
            <span className="card-tag badge-pdf">PDF</span>
          )}
        </div>
      </div>
      <p className="literature-provenance">{provenance}</p>
      <p style={{ margin: "10px 0 6px 0" }}>
        <strong>Why this paper:</strong>{" "}
        {paper.why || "Matches the marker/phenotype query."}
      </p>
      {paper.takeaway && (
        <p style={{ margin: "0 0 10px 0" }}>
          <strong>Takeaway:</strong> {paper.takeaway}
        </p>
      )}
      {paper.excerpt && (
        <details>
          <summary style={{ cursor: "pointer" }}>Excerpt</summary>
          <p style={{ marginTop: "8px" }}>{paper.excerpt}</p>
        </details>
      )}
      <div className="literature-links">
        {paper.pubmedUrl && (
          <a href={paper.pubmedUrl} target="_blank" rel="noreferrer">
            PubMed
          </a>
        )}
        {paper.pmcUrl && (
          <a href={paper.pmcUrl} target="_blank" rel="noreferrer">
            PMC
          </a>
        )}
        {paper.pdfUrl && (
          <a href={paper.pdfUrl} target="_blank" rel="noreferrer">
            PDF
          </a>
        )}
      </div>
    </article>
  );

  const renderCitations = () => {
    if (!aiCitations || aiCitations.length === 0) {
      return null;
    }
    return (
      <section
        className="ai-citations-section"
        style={{
          marginTop: "24px",
          paddingTop: "20px",
          borderTop: "1px solid var(--stroke)",
        }}
      >
        <h4
          style={{
            marginBottom: "12px",
            fontSize: "14px",
            fontWeight: 600,
            color: "var(--ink)",
          }}
        >
          Research Papers
        </h4>
        <div className="citations-list">
          {aiCitations.map((citation, index) => (
            <div
              key={`citation-${index}`}
              className="citation-item"
              style={{
                padding: "12px",
                marginBottom: "8px",
                backgroundColor: "var(--panel)",
                borderLeft: "3px solid var(--accent)",
                borderRadius: "4px",
              }}
            >
              <div style={{ marginBottom: "4px" }}>
                <a
                  href={`https://pubmed.ncbi.nlm.nih.gov/${citation.pmid}/`}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    color: "var(--accent)",
                    textDecoration: "none",
                    fontWeight: 600,
                  }}
                >
                  {citation.title || "Untitled"}
                </a>
              </div>
              <div
                style={{
                  fontSize: "12px",
                  color: "var(--muted)",
                  marginBottom: "4px",
                }}
              >
                {citation.authors && <span>{citation.authors}</span>}
                {citation.pubdate && <span> • {citation.pubdate}</span>}
              </div>
              {citation.relevance && (
                <div
                  style={{
                    fontSize: "12px",
                    color: "var(--ink)",
                    fontStyle: "italic",
                  }}
                >
                  {citation.relevance}
                </div>
              )}
            </div>
          ))}
        </div>
      </section>
    );
  };

  const literature = (aiInsight as { literature?: LiteraturePayload } | null)
    ?.literature;
  const literatureBuckets = [
    ...(literature?.markers || []),
    ...(literature?.phenotypes || []),
    ...(literature?.combined ? [literature.combined] : []),
  ].filter(Boolean) as LiteratureBucket[];

  const filteredLiteratureBuckets = literatureBuckets.filter((bucket) => {
    if (literatureTierFilter !== "all" && bucket.tier !== literatureTierFilter) {
      return false;
    }
    if (!fullTextOnly) return true;
    return bucket.papers.some((paper) => paper.fullTextAvailable);
  });
  const selectedPhenotypeLabel = selectedNodeId
    ? treeData?.phenotypes?.find((phenotype) => phenotype.population === selectedNodeId)
        ?.label
    : null;
  const phenotypeLiterature = selectedPhenotypeLabel
    ? literature?.phenotypes?.find((bucket) => bucket.label === selectedPhenotypeLabel)
    : null;
  const phenotypeHasFullText = Boolean(
    phenotypeLiterature?.papers?.some((paper) => paper.fullTextAvailable),
  );

  const handleAnalyze = async () => {
    if (!selectedFiles || selectedFiles.length === 0) {
      setError("Please select at least one FCS file");
      return;
    }

    setAnalyzing(true);
    setError(null);
    setProgress(0);
    setAiError(null);
    setAiInsight(null);
    setAiCitations([]);

    try {
      // Convert files to base64
      const filesData = [];

      for (let i = 0; i < selectedFiles.length; i++) {
        const file = selectedFiles[i];
        const base64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => {
            const result = reader.result as string;
            // Extract base64 part (after data:...;base64,)
            const base64String = result.split(",")[1];
            resolve(base64String);
          };
          reader.onerror = () => reject(reader.error);
          reader.readAsDataURL(file);
        });

        filesData.push({
          name: file.name,
          content: base64,
        });
        setProgress(Math.round(((i + 1) / selectedFiles.length) * 60));
      }

      // Send to batch endpoint
      const apiUrl = import.meta.env.VITE_API_URL || "http://localhost:8000";
      setProgress((current) => Math.max(current, 65));
      if (progressTimerRef.current) {
        window.clearInterval(progressTimerRef.current);
      }
      progressTimerRef.current = window.setInterval(() => {
        setProgress((current) => (current < 95 ? current + 1 : current));
      }, 1200);
      const response = await fetch(`${apiUrl}/analyze-batch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          files: filesData,
          t: threshold,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`API error: ${response.status} - ${errorText}`);
      }

      const data = await response.json();

      if (data.error) {
        throw new Error(Array.isArray(data.error) ? data.error[0] : data.error);
      }

      setProgress(100);

      // Set initial scatter plot markers
      if (data.cellDataMarkers) {
        setScatterXMarker(data.cellDataMarkers.x);
        setScatterYMarker(data.cellDataMarkers.y);
      } else if (data.markers && data.markers.length >= 2) {
        setScatterXMarker(data.markers[0]);
        setScatterYMarker(data.markers[1]);
      }

      setTreeData(data);
      void runAiInsights(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
      console.error("Analysis error:", err);
    } finally {
      if (progressTimerRef.current) {
        window.clearInterval(progressTimerRef.current);
        progressTimerRef.current = null;
      }
      setAnalyzing(false);
    }
  };


  useEffect(() => {
    if (!analyzing) {
      setElapsedTime(0);
      if (elapsedTimerRef.current) {
        window.clearInterval(elapsedTimerRef.current);
        elapsedTimerRef.current = null;
      }
      return;
    }
    elapsedTimerRef.current = window.setInterval(() => {
      setElapsedTime((prev) => prev + 1);
    }, 1000);

    return () => {
      if (elapsedTimerRef.current) {
        window.clearInterval(elapsedTimerRef.current);
        elapsedTimerRef.current = null;
      }
    };
  }, [analyzing]);

  return (
    <div className="app">
      <a href="#main-content" className="skip-link" onClick={skipToMainContent}>
        Skip to main content
      </a>
      <header className="app-header" role="banner">
        <div>
          <p className="app-kicker">Cytometry Explorer</p>
          <h1>CytomeTreeD3</h1>
          <p className="app-subtitle">
            Upload FCS files, run CytomeTree, and explore populations in a
            dashboard view.
          </p>
        </div>
        <div className="status-chip" aria-label="File upload status">
          <span className="status-dot" />
          {selectedFiles && selectedFiles.length > 0
            ? `${selectedFiles.length} file${selectedFiles.length > 1 ? "s" : ""} ready`
            : "No files loaded"}
        </div>
      </header>

      <div className="app-grid">
        <nav role="navigation" aria-label="Main navigation" className="sidebar">
          <section
            className="card"
            role="region"
            aria-labelledby="upload-analyze-heading"
          >
            <div className="card-header">
              <h2 id="upload-analyze-heading">Upload & Analyze</h2>
              <span className="card-tag">Batch mode</span>
            </div>
            <div style={{ marginBottom: "16px" }}>
              <label
                htmlFor="research-context"
                style={{
                  display: "block",
                  marginBottom: "4px",
                  fontWeight: 600,
                }}
              >
                Research Context{" "}
                <span style={{ color: "var(--muted)", fontWeight: 400 }}>
                  (optional)
                </span>
              </label>
              <input
                id="research-context"
                type="text"
                value={researchContext}
                onChange={(e) => setResearchContext(e.target.value)}
                placeholder="e.g., Chronic Lymphocytic Leukemia"
                style={{
                  width: "100%",
                  padding: "8px 12px",
                  border: "1px solid var(--stroke)",
                  borderRadius: "8px",
                  fontSize: "14px",
                  color: "var(--ink)",
                  backgroundColor: "var(--panel)",
                  fontFamily: "inherit",
                }}
              />
              <p
                style={{
                  fontSize: "12px",
                  color: "var(--muted)",
                  margin: "4px 0 0 0",
                }}
              >
                Provide disease/condition context for more accurate phenotype
                mapping
              </p>
            </div>
            <label className="file-input">
              <span>Select FCS files</span>
              <input
                type="file"
                multiple
                accept=".fcs"
                onChange={handleFileSelect}
                disabled={analyzing}
                aria-describedby="file-input-help"
              />
            </label>
            <span id="file-input-help" className="sr-only">
              Select one or more FCS files to analyze
            </span>
            {selectedFiles && selectedFiles.length > 0 && (
              <p className="muted" aria-live="polite">
                {selectedFiles.length} file(s) selected
              </p>
            )}
            <div className="slider-row">
              <label htmlFor="threshold-slider">
                Threshold (t)
                <span>{threshold.toFixed(2)}</span>
              </label>
              <input
                id="threshold-slider"
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={threshold}
                onChange={(e) => setThreshold(parseFloat(e.target.value))}
                disabled={analyzing}
                aria-valuenow={threshold}
                aria-valuemin={0}
                aria-valuemax={1}
                aria-label="Analysis threshold"
              />
            </div>
            <button
              className="primary-button"
              onClick={handleAnalyze}
              disabled={
                analyzing || !selectedFiles || selectedFiles.length === 0
              }
              aria-busy={analyzing}
            >
              {analyzing ? "Analyzing..." : "Analyze"}
            </button>
            {analyzing && (
              <div
                className="progress-block"
                style={{ "--progress": `${progress}%` } as CSSProperties}
                role="progressbar"
                aria-valuenow={progress}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label="Analysis progress"
              >
                <div className="progress-bar">
                  <div className="progress-fill" />
                </div>
                <span className="progress-label">
                  {progress}% • {Math.floor(elapsedTime / 60)}:
                  {String(elapsedTime % 60).padStart(2, "0")}
                </span>
              </div>
            )}
            {error && (
              <p className="error" role="alert">
                Error: {error}
              </p>
            )}
          </section>

          <section
            className="card highlight-card"
            role="region"
            aria-labelledby="session-notes-heading"
          >
            <h3 id="session-notes-heading">Session Notes</h3>
            {/*<p className="muted"> </p>*/}
            <div className="stat-row">
              <div>
                <span>Threshold</span>
                <strong>{threshold.toFixed(2)}</strong>
              </div>
              <div>
                <span>Status</span>
                <strong>
                  {analyzing ? "Running" : treeData ? "Ready" : "Idle"}
                </strong>
              </div>
            </div>
          </section>
        </nav>

        <main id="main-content" className="content" role="main">
          {!treeData && (
            <section
              className="card empty-state"
              role="region"
              aria-labelledby="awaiting-analysis-heading"
            >
              <h2 id="awaiting-analysis-heading">Awaiting analysis</h2>
              <p className="muted">
                Upload one or more FCS files and hit Analyze to generate your
                population tree and scatter plots.
              </p>
            </section>
          )}

          {treeData && (
            <>
              <section
                className="card summary-card"
                role="region"
                aria-labelledby="analysis-results-heading"
              >
                <div>
                  <h2 id="analysis-results-heading">Analysis Results</h2>
                  <p className="muted">
                    Summary of detected populations and markers.
                  </p>
                </div>
                <div className="summary-metrics">
                  <div>
                    <span>Total Cells</span>
                    <strong>{treeData.cells}</strong>
                  </div>
                  <div>
                    <span>Populations</span>
                    <strong>{treeData.populations}</strong>
                  </div>
                </div>
                {treeData.markers && treeData.markers.length > 0 && (
                  <div className="chips" aria-label="Detected markers">
                    {treeData.markers.slice(0, 8).map((marker) => (
                      <span
                        className="chip"
                        key={marker}
                        aria-label={`Marker: ${marker}`}
                      >
                        {marker}
                      </span>
                    ))}
                    {treeData.markers.length > 8 && (
                      <span
                        className="chip muted"
                        aria-label={`Plus ${treeData.markers.length - 8} more markers`}
                      >
                        +{treeData.markers.length - 8} more
                      </span>
                    )}
                  </div>
                )}
              </section>

              <section
                className="card ai-card"
                role="region"
                aria-labelledby="ai-insights-heading"
              >
                <div className="card-header">
                  <h2 id="ai-insights-heading">AI Insights</h2>
                  <div className="ai-toolbar">
                    <select
                      className="ai-select"
                      value={aiModel}
                      onChange={(event) => setAiModel(event.target.value)}
                      disabled={aiModels.length === 0 || aiLoading}
                    >
                      {aiModels.length === 0 && (
                        <option value="">No models</option>
                      )}
                      {aiModels.map((model) => (
                        <option key={model} value={model}>
                          {model}
                        </option>
                      ))}
                    </select>
                    <button
                      className="ai-button"
                      onClick={() => treeData && runAiInsights(treeData)}
                      disabled={!treeData || aiModels.length === 0 || aiLoading}
                    >
                      {aiLoading ? "Generating…" : "Regenerate"}
                    </button>
                  </div>
                </div>
                {aiModels.length === 0 && (
                  <p className="muted">
                    Add `ALLOWED_MODELS` to the Cloudflare Worker to enable AI
                    insights.
                  </p>
                )}
                {aiLoading && (
                  <div className="ai-loading">
                    <span className="ai-pulse" />
                    Generating insights<span className="ai-dots">...</span>
                  </div>
                )}
                {aiError && <p className="error">{aiError}</p>}
                {aiInsight && (
                  <div className="ai-insights-container">
                    <div className="ai-grid">
                      {aiInsight.phenotype_mapping && (
                        <section
                          className="ai-section"
                          style={{ gridColumn: "1 / -1" }}
                        >
                          <h3>Phenotype Mapping</h3>
                          {renderAiList(aiInsight.phenotype_mapping)}
                        </section>
                      )}

                      {aiInsight.dominant_lineage && (
                        <section className="ai-section">
                          <h3>Dominant Lineage</h3>
                          <p className="ai-insight-text">
                            {String(aiInsight.dominant_lineage)}
                          </p>
                        </section>
                      )}

                      {aiInsight.rare_subsets && (
                        <section className="ai-section">
                          <h3>Rare Subsets</h3>
                          {renderAiList(aiInsight.rare_subsets)}
                        </section>
                      )}

                      {aiInsight.artifact_flags && (
                        <section className="ai-section">
                          <h3>Artifact Flags</h3>
                          {renderAiList(aiInsight.artifact_flags)}
                        </section>
                      )}

                      {aiInsight.key_findings && (
                        <section
                          className="ai-section"
                          style={{ gridColumn: "1 / -1" }}
                        >
                          <h3>Key Findings</h3>
                          {renderAiList(aiInsight.key_findings)}
                        </section>
                      )}
                    </div>
                    {renderCitations()}
                  </div>
                )}
                {!aiLoading &&
                  !aiError &&
                  !aiInsight &&
                  aiModels.length > 0 && (
                    <p className="muted">
                      Insights will appear here after analysis finishes.
                    </p>
                  )}
              </section>

              {aiInsight && literature && (
                <section
                  className="card"
                  role="region"
                  aria-labelledby="literature-explorer-heading"
                >
                  <div className="card-header">
                    <h2 id="literature-explorer-heading">Literature Explorer</h2>
                    <span className="card-tag">
                      {literatureBuckets.length} groups
                    </span>
                  </div>
                  <div
                    className="ai-toolbar"
                    style={{
                      justifyContent: "space-between",
                      flexWrap: "wrap",
                      gap: "12px",
                      marginBottom: "16px",
                    }}
                  >
                    <label style={{ display: "flex", gap: "8px" }}>
                      <span className="muted">Tier</span>
                      <select
                        className="ai-select"
                        value={literatureTierFilter}
                        onChange={(event) =>
                          setLiteratureTierFilter(
                            event.target.value as
                              | "all"
                              | "marker"
                              | "phenotype"
                              | "combined",
                          )
                        }
                      >
                        <option value="all">All</option>
                        <option value="marker">Marker</option>
                        <option value="phenotype">Phenotype</option>
                        <option value="combined">Combined</option>
                      </select>
                    </label>
                    <label style={{ display: "flex", gap: "8px" }}>
                      <input
                        type="checkbox"
                        checked={fullTextOnly}
                        onChange={(event) => setFullTextOnly(event.target.checked)}
                      />
                      <span className="muted">Full text only</span>
                    </label>
                  </div>
                  {filteredLiteratureBuckets.length === 0 && (
                    <p className="muted">No literature groups match filters.</p>
                  )}
                  {filteredLiteratureBuckets.map((bucket, idx) => {
                    const papers = fullTextOnly
                      ? bucket.papers.filter((paper) => paper.fullTextAvailable)
                      : bucket.papers;
                    const provenance =
                      bucket.tier === "marker"
                        ? `Matched on marker: ${bucket.label}`
                        : bucket.tier === "phenotype"
                          ? `Matched on phenotype: ${bucket.label}`
                          : "Matched on combined markers";
                    return (
                      <section
                        key={`${bucket.tier}-${bucket.label}-${idx}`}
                        style={{ marginBottom: "18px" }}
                      >
                        <div
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            flexWrap: "wrap",
                            gap: "12px",
                            marginBottom: "8px",
                          }}
                        >
                          <div>
                            <h3 style={{ marginBottom: "4px" }}>
                              {bucket.label}
                            </h3>
                            <p className="muted" style={{ margin: 0 }}>
                              {bucket.tier.toUpperCase()} query: {bucket.query}
                            </p>
                          </div>
                          <span className="card-tag">
                            {papers.length} papers
                          </span>
                        </div>
                        {papers.length === 0 && (
                          <p className="muted">No papers available.</p>
                        )}
                        <div
                          className="literature-grid"
                        >
                          {papers
                            .slice(0, 6)
                            .map((paper, paperIndex) =>
                              renderLiteraturePaper(paper, paperIndex, provenance),
                            )}
                        </div>
                        {papers.length > 6 && (
                          <p className="muted" style={{ marginTop: "8px" }}>
                            +{papers.length - 6} more papers available.
                          </p>
                        )}
                      </section>
                    );
                  })}
                </section>
              )}

              {treeData.phenotypes && treeData.phenotypes.length > 0 && (
                <section
                  className="card"
                  role="region"
                  aria-labelledby="phenotype-filter-heading"
                >
                  <div className="card-header">
                    <h2 id="phenotype-filter-heading">Phenotype Filter</h2>
                    <span className="card-tag">
                      {treeData.phenotypes.length} phenotypes
                    </span>
                  </div>
                  <div
                    className="button-grid"
                    role="group"
                    aria-label="Phenotype selection"
                  >
                    <button
                      onClick={() => setSelectedPhenotype(null)}
                      className={`tag-button ${selectedPhenotype === null ? "active" : ""}`}
                      aria-pressed={selectedPhenotype === null}
                    >
                      All Cells ({treeData.cells})
                    </button>
                    {treeData.phenotypes.map((pheno, index) => (
                      <button
                        key={`pheno-${index}`}
                        onClick={() => setSelectedPhenotype(pheno.key)}
                        className={`tag-button ${selectedPhenotype === pheno.key ? "active" : ""}`}
                        title={`${pheno.count} cells (${(pheno.proportion * 100).toFixed(1)}%)`}
                        aria-pressed={selectedPhenotype === pheno.key}
                        aria-label={`${pheno.label} - ${(pheno.proportion * 100).toFixed(1)}% of cells`}
                      >
                        {pheno.label} ({(pheno.proportion * 100).toFixed(1)}%)
                      </button>
                    ))}
                  </div>
                </section>
              )}

              {treeData.cellData && treeData.cellData.length > 0 && (
                <section
                  className="card"
                  role="region"
                  aria-labelledby="gating-overview-heading"
                >
                  <h2 id="gating-overview-heading">Gating Overview</h2>
                  <GatingOverview
                    cellData={treeData.cellData}
                    markers={treeData.markers || []}
                  />
                </section>
              )}

              {treeData.cellData && treeData.cellData.length > 0 && (
                <section
                  className="card"
                  role="region"
                  aria-labelledby="interactive-cell-distribution-heading"
                >
                  <div className="card-header">
                    <h2 id="interactive-cell-distribution-heading">
                      Interactive Cell Distribution
                    </h2>
                    <span className="card-tag">Scatter</span>
                  </div>
                  <CellScatter
                    cellData={treeData.cellData}
                    markers={treeData.markers || []}
                    phenotypes={treeData.phenotypes}
                    xMarker={scatterXMarker}
                    yMarker={scatterYMarker}
                    onMarkerChange={(x, y) => {
                      setScatterXMarker(x);
                      setScatterYMarker(y);
                    }}
                    selectedPopulation={
                      selectedPhenotype && treeData.phenotypes
                        ? treeData.phenotypes.find(
                            (p) => p.key === selectedPhenotype,
                          )?.population
                        : undefined
                    }
                  />
                </section>
              )}

              <section
                className="card"
                role="region"
                aria-labelledby="population-tree-heading"
              >
                <h2 id="population-tree-heading">Population Tree</h2>
                <TreeViz
                  data={{
                    nodes:
                      treeData.treeNodes && treeData.treeNodes.length > 0
                        ? treeData.treeNodes
                        : treeData.nodes,
                    links:
                      treeData.treeLinks && treeData.treeLinks.length > 0
                        ? treeData.treeLinks
                        : treeData.links,
                  }}
                  onLeafNodeClick={handleLeafNodeClick}
                />
              </section>
            </>
          )}
        </main>
      </div>

      {/* Granular Analysis Modal */}
      {showGranularModal && (
        <div
          className="modal-overlay"
          onClick={() => setShowGranularModal(false)}
        >
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <button
              className="modal-close"
              onClick={() => setShowGranularModal(false)}
              aria-label="Close modal"
            >
              ×
            </button>
            <div className="modal-header">
              <h2>Population {selectedNodeId} Analysis</h2>
              {phenotypeHasFullText && (
                <span className="card-tag badge-fulltext">
                  Full Text Available
                </span>
              )}
            </div>
            {granularLoading && (
              <p style={{ color: "var(--muted)" }}>Analyzing phenotype...</p>
            )}
            {granularInsight && !granularLoading && (
              <div>
                {granularInsight.error && (
                  <p className="error">{String(granularInsight.error)}</p>
                )}
                {granularInsight.phenotype_name && (
                  <section style={{ marginBottom: "16px" }}>
                    <h3>Phenotype Name</h3>
                    <p>{String(granularInsight.phenotype_name)}</p>
                  </section>
                )}
                {granularInsight.biological_significance && (
                  <section style={{ marginBottom: "16px" }}>
                    <h3>Biological Significance</h3>
                    <p>{String(granularInsight.biological_significance)}</p>
                  </section>
                )}
                {granularInsight.clinical_relevance && (
                  <section style={{ marginBottom: "16px" }}>
                    <h3>Clinical Relevance</h3>
                    <div
                      className="inline-citations"
                      dangerouslySetInnerHTML={{
                        __html: String(granularInsight.clinical_relevance),
                      }}
                    />
                  </section>
                )}
                {granularInsight.marker_interpretation &&
                  typeof granularInsight.marker_interpretation === "object" && (
                    <section style={{ marginBottom: "16px" }}>
                      <h3>Per-Marker Interpretation</h3>
                      <ul className="ai-list">
                        {Object.entries(
                          granularInsight.marker_interpretation,
                        ).map(([marker, interp]: [string, any]) => (
                          <li key={marker}>
                            <strong>{marker}:</strong> {String(interp)}
                          </li>
                        ))}
                      </ul>
                    </section>
                  )}
                {phenotypeLiterature && phenotypeLiterature.papers.length > 0 && (
                  <section style={{ marginBottom: "16px" }}>
                    <h3>Phenotype Literature</h3>
                    <p className="muted" style={{ marginTop: "-4px" }}>
                      Query: {phenotypeLiterature.query}
                    </p>
                    <div
                      className="literature-grid"
                    >
                      {phenotypeLiterature.papers
                        .slice(0, 4)
                        .map((paper, paperIndex) =>
                          renderLiteraturePaper(
                            paper,
                            paperIndex,
                            `Matched on phenotype: ${phenotypeLiterature.label}`,
                          ),
                        )}
                    </div>
                    {phenotypeLiterature.papers.length > 4 && (
                      <p className="muted" style={{ marginTop: "8px" }}>
                        +{phenotypeLiterature.papers.length - 4} more papers in
                        Literature Explorer.
                      </p>
                    )}
                  </section>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
