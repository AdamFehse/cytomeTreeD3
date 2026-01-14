import { useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import './App.css'
import TreeViz from './TreeViz'
import CellScatter from './CellScatter'
import GatingOverview from './GatingOverview'

const DEFAULT_WORKER = 'https://cytomaitree.adamfehse.workers.dev/'

interface Phenotype {
  key: string
  label: string
  population: number
  count: number
  proportion: number
}

interface TreeData {
  nodes: Array<{ id: number; name: string; marker: string; cells: number }>
  links: Array<{ source: number; target: number }>
  treeNodes?: Array<{ id: number; name: string; marker: string; cells?: number; threshold?: number }>
  treeLinks?: Array<{ source: number; target: number }>
  populations: number
  cells: number
  markers?: string[]
  cellData?: Array<{ x: number; y: number; population: number }>
  cellDataMarkers?: { x: string; y: string }
  phenotypes?: Phenotype[]
}

function App() {
  const [treeData, setTreeData] = useState<TreeData | null>(null)
  const [analyzing, setAnalyzing] = useState(false)
  const [joke, setJoke] = useState('')
  const [aiJokes, setAiJokes] = useState<string[]>([])
  const [aiFacts, setAiFacts] = useState<string[]>([])
  const [aiTrivia, setAiTrivia] = useState<string[]>([])
  const [jokeIndex, setJokeIndex] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [threshold, setThreshold] = useState(0.1)
  const [selectedFiles, setSelectedFiles] = useState<FileList | null>(null)
  const [scatterXMarker, setScatterXMarker] = useState<string>('')
  const [scatterYMarker, setScatterYMarker] = useState<string>('')
  const [selectedPhenotype, setSelectedPhenotype] = useState<string | null>(null)
  const [progress, setProgress] = useState(0)
  const [elapsedTime, setElapsedTime] = useState(0)
  const progressTimerRef = useRef<number | null>(null)
  const jokeTimerRef = useRef<number | null>(null)
  const elapsedTimerRef = useRef<number | null>(null)
  const [aiModels, setAiModels] = useState<string[]>([])
  const [aiModel, setAiModel] = useState<string>('')
  const [aiInsight, setAiInsight] = useState<Record<string, unknown> | null>(null)
  const [aiLoading, setAiLoading] = useState(false)
  const [aiError, setAiError] = useState<string | null>(null)

  // Skip link functionality
  const skipToMainContent = () => {
    const mainContent = document.querySelector('main[role="main"]');
    if (mainContent) {
      mainContent.setAttribute('tabIndex', '-1');
      mainContent.addEventListener('blur', () => {
        mainContent.removeAttribute('tabIndex');
      }, { once: true });
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSelectedFiles(e.target.files)
  }

  useEffect(() => {
    const controller = new AbortController()
    const loadModels = async () => {
      try {
        const response = await fetch(DEFAULT_WORKER, { signal: controller.signal })
        if (!response.ok) return
        const data = await response.json()
        const models = Array.isArray(data.allowed_models) ? data.allowed_models.filter(Boolean) : []
        setAiModels(models)
        if (models.length > 0) {
          setAiModel((current) => current || models[0])
        }
      } catch {
        // Ignore model load failures; AI can still be enabled later.
      }
    }
    loadModels()
    return () => controller.abort()
  }, [])

  const loadModelsOnce = async () => {
    if (aiModels.length > 0) return aiModels
    try {
      const response = await fetch(DEFAULT_WORKER)
      if (!response.ok) return []
      const data = await response.json()
      const models = Array.isArray(data.allowed_models) ? data.allowed_models.filter(Boolean) : []
      if (models.length > 0) {
        setAiModels(models)
        setAiModel((current) => current || models[0])
      }
      return models
    } catch {
      return []
    }
  }


  useEffect(() => {
    if (!treeData || aiModels.length === 0 || aiLoading || aiInsight || aiError) {
      return
    }
    void runAiInsights(treeData)
  }, [aiModels, treeData, aiLoading, aiInsight, aiError])

  const callWorker = async (prompt: string, model?: string, type?: 'engagement' | 'insights') => {
    const controller = new AbortController()
    const timeoutId = window.setTimeout(() => controller.abort(), 30000)

    try {
      const response = await fetch(DEFAULT_WORKER, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: prompt, model, type }),
        signal: controller.signal
      })

      if (!response.ok) {
        const body = await response.text().catch(() => '')
        throw new Error(`AI request failed (${response.status}). ${body}`)
      }

      return response.json()
    } finally {
      window.clearTimeout(timeoutId)
    }
  }

  const fetchEngagementLines = async () => {
    const models = await loadModelsOnce()
    if (models.length === 0) {
      console.log('No models available for engagement lines')
      setAiJokes([])
      setAiFacts([])
      setAiTrivia([])
      return
    }
    // Use the first (fastest) model from ALLOWED_MODELS
    const model = models[0]
    console.log('Fetching engagement lines with model:', model)

    try {
      const result = await callWorker('', model, 'engagement')
      console.log('Engagement API response:', result)
      let payload = result
      if (typeof result === 'string') {
        try {
          payload = JSON.parse(result)
        } catch {
          payload = result
        }
      }
      const lines = Array.isArray(payload?.lines)
        ? payload.lines.filter(Boolean)
        : Array.isArray(payload)
          ? payload.filter(Boolean)
          : []
      const facts = Array.isArray(payload?.facts) ? payload.facts.filter(Boolean) : []
      const trivia = Array.isArray(payload?.trivia) ? payload.trivia.filter(Boolean) : []
      console.log('Parsed engagement content:', { lines, facts, trivia })
      setAiJokes(lines)
      setAiFacts(facts)
      setAiTrivia(trivia)
    } catch (err) {
      console.error('Engagement lines error:', err)
      setAiJokes([])
      setAiFacts([])
      setAiTrivia([])
    }
  }


  const buildAiPayload = (data: TreeData) => {
    const treeNodes = data.treeNodes && data.treeNodes.length > 0 ? data.treeNodes : data.nodes
    const treeLinks = data.treeLinks && data.treeLinks.length > 0 ? data.treeLinks : data.links
    return {
      summary: {
        total_cells: data.cells,
        populations: data.populations,
        markers: data.markers || [],
        scatter_markers: data.cellDataMarkers || null
      },
      tree: {
        nodes: treeNodes.slice(0, 200),
        links: treeLinks.slice(0, 400)
      },
      phenotypes: data.phenotypes ? data.phenotypes.slice(0, 120) : [],
      notes: {
        cell_data_included: false,
        omitted: ['cellData'],
        node_limit: 200,
        link_limit: 400,
        phenotype_limit: 120
      }
    }
  }

  const runAiInsights = async (data: TreeData) => {
    if (aiModels.length === 0 || !aiModel) {
      return
    }
    setAiLoading(true)
    setAiError(null)
    setAiInsight(null)
    try {
      const payload = buildAiPayload(data)
      const prompt = [
        'You are an expert cytometry analyst.',
        'Analyze the JSON dataset and return concise insights for a dashboard viewer.',
        'Return ONLY valid JSON with these keys:',
        '{',
        '  "summary": "2-4 sentences explaining the overall result",',
        '  "key_findings": ["bullet", "bullet"],',
        '  "notable_populations": ["name or label with reason"],',
        '  "anomalies": ["potential issues or flags"],',
        '  "suggested_next_steps": ["action", "action"],',
        '  "visualization_tips": ["tip", "tip"]',
        '}',
        '',
        'DATA:',
        JSON.stringify(payload)
      ].join('\n')

      const result = await callWorker(prompt, aiModel, 'insights')
      setAiInsight(result)
    } catch (err) {
      setAiError(err instanceof Error ? err.message : 'AI request failed')
    } finally {
      setAiLoading(false)
    }
  }

  const renderAiList = (value: unknown) => {
    if (!Array.isArray(value) || value.length === 0) {
      return <p className="muted">Not observed.</p>
    }
    return (
      <ul className="ai-list">
        {value.map((item, index) => (
          <li key={`${index}-${String(item)}`}>{String(item)}</li>
        ))}
      </ul>
    )
  }

  const handleAnalyze = async () => {
    if (!selectedFiles || selectedFiles.length === 0) {
      setError('Please select at least one FCS file')
      return
    }

    setAnalyzing(true)
    setError(null)
    setProgress(0)
    setAiError(null)
    setAiInsight(null)
    setAiJokes([])
    setAiFacts([])
    setAiTrivia([])
    setJoke('Warming up fun facts...')
    setJokeIndex(0)
    void fetchEngagementLines()

    try {
      // Convert files to base64
      const filesData = []

      for (let i = 0; i < selectedFiles.length; i++) {
        const file = selectedFiles[i]
        const base64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader()
          reader.onload = () => {
            const result = reader.result as string
            // Extract base64 part (after data:...;base64,)
            const base64String = result.split(',')[1]
            resolve(base64String)
          }
          reader.onerror = () => reject(reader.error)
          reader.readAsDataURL(file)
        })

        filesData.push({
          name: file.name,
          content: base64
        })
        setProgress(Math.round(((i + 1) / selectedFiles.length) * 60))
      }

      // Send to batch endpoint
      const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:8000'
      setProgress((current) => Math.max(current, 65))
      if (progressTimerRef.current) {
        window.clearInterval(progressTimerRef.current)
      }
      progressTimerRef.current = window.setInterval(() => {
        setProgress((current) => (current < 95 ? current + 1 : current))
      }, 1200)
      const response = await fetch(`${apiUrl}/analyze-batch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          files: filesData,
          t: threshold
        })
      })

      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(`API error: ${response.status} - ${errorText}`)
      }

      const data = await response.json()

      if (data.error) {
        throw new Error(Array.isArray(data.error) ? data.error[0] : data.error)
      }

      setProgress(100)

      // Set initial scatter plot markers
      if (data.cellDataMarkers) {
        setScatterXMarker(data.cellDataMarkers.x)
        setScatterYMarker(data.cellDataMarkers.y)
      } else if (data.markers && data.markers.length >= 2) {
        setScatterXMarker(data.markers[0])
        setScatterYMarker(data.markers[1])
      }

      setTreeData(data)
      void runAiInsights(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
      console.error('Analysis error:', err)
    } finally {
      if (progressTimerRef.current) {
        window.clearInterval(progressTimerRef.current)
        progressTimerRef.current = null
      }
      if (jokeTimerRef.current) {
        window.clearInterval(jokeTimerRef.current)
        jokeTimerRef.current = null
      }
      setAnalyzing(false)
    }
  }

  useEffect(() => {
    if (!analyzing || (aiJokes.length === 0 && aiFacts.length === 0 && aiTrivia.length === 0)) return
    // Combine all content into one cycling pool
    const allContent = [...aiJokes, ...aiFacts, ...aiTrivia]
    setJoke(allContent[0])
    setJokeIndex(0)
    if (jokeTimerRef.current) {
      window.clearInterval(jokeTimerRef.current)
    }
    jokeTimerRef.current = window.setInterval(() => {
      setJokeIndex((prev) => {
        const next = (prev + 1) % allContent.length
        setJoke(allContent[next])
        return next
      })
    }, 3600)

    return () => {
      if (jokeTimerRef.current) {
        window.clearInterval(jokeTimerRef.current)
        jokeTimerRef.current = null
      }
    }
  }, [analyzing, aiJokes, aiFacts, aiTrivia])

  useEffect(() => {
    if (!analyzing) {
      setElapsedTime(0)
      if (elapsedTimerRef.current) {
        window.clearInterval(elapsedTimerRef.current)
        elapsedTimerRef.current = null
      }
      return
    }
    elapsedTimerRef.current = window.setInterval(() => {
      setElapsedTime((prev) => prev + 1)
    }, 1000)

    return () => {
      if (elapsedTimerRef.current) {
        window.clearInterval(elapsedTimerRef.current)
        elapsedTimerRef.current = null
      }
    }
  }, [analyzing])

  return (
    <div className="app">
      <a href="#main-content" className="skip-link" onClick={skipToMainContent}>Skip to main content</a>
      <header className="app-header" role="banner">
        <div>
          <p className="app-kicker">Cytometry Explorer</p>
          <h1>CytomeTreeD3</h1>
          <p className="app-subtitle">Upload FCS files, run CytomeTree, and explore populations in a dashboard view.</p>
        </div>
        <div className="status-chip" aria-label="File upload status">
          <span className="status-dot" />
          {selectedFiles && selectedFiles.length > 0
            ? `${selectedFiles.length} file${selectedFiles.length > 1 ? 's' : ''} ready`
            : 'No files loaded'}
        </div>
      </header>

      <div className="app-grid">
        <nav role="navigation" aria-label="Main navigation" className="sidebar">
          <section className="card" role="region" aria-labelledby="upload-analyze-heading">
            <div className="card-header">
              <h2 id="upload-analyze-heading">Upload & Analyze</h2>
              <span className="card-tag">Batch mode</span>
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
            <span id="file-input-help" className="sr-only">Select one or more FCS files to analyze</span>
            {selectedFiles && selectedFiles.length > 0 && (
              <p className="muted" aria-live="polite">{selectedFiles.length} file(s) selected</p>
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
              disabled={analyzing || !selectedFiles || selectedFiles.length === 0}
              aria-busy={analyzing}
            >
              {analyzing ? 'Analyzing...' : 'Analyze'}
            </button>
            {analyzing && (
              <div className="progress-block" style={{ '--progress': `${progress}%` } as CSSProperties} role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100} aria-label="Analysis progress">
                <p className="joke">{joke}</p>
                <div className="progress-bar">
                  <div className="progress-fill" />
                </div>
                <span className="progress-label">{progress}% • {Math.floor(elapsedTime / 60)}:{String(elapsedTime % 60).padStart(2, '0')}</span>
              </div>
            )}
            {error && <p className="error" role="alert">Error: {error}</p>}
          </section>

          <section className="card highlight-card" role="region" aria-labelledby="session-notes-heading">
            <h3 id="session-notes-heading">Session Notes</h3>
            <p className="muted">
              Large batches can take a while on Render. Keep this tab open while the analysis runs.
            </p>
            <div className="stat-row">
              <div>
                <span>Threshold</span>
                <strong>{threshold.toFixed(2)}</strong>
              </div>
              <div>
                <span>Status</span>
                <strong>{analyzing ? 'Running' : treeData ? 'Ready' : 'Idle'}</strong>
              </div>
            </div>
          </section>
        </nav>

        <main id="main-content" className="content" role="main">
          {!treeData && (
            <section className="card empty-state" role="region" aria-labelledby="awaiting-analysis-heading">
              <h2 id="awaiting-analysis-heading">Awaiting analysis</h2>
              <p className="muted">
                Upload one or more FCS files and hit Analyze to generate your population tree and scatter plots.
              </p>
            </section>
          )}

          {treeData && (
            <>
              <section className="card summary-card" role="region" aria-labelledby="analysis-results-heading">
                <div>
                  <h2 id="analysis-results-heading">Analysis Results</h2>
                  <p className="muted">Summary of detected populations and markers.</p>
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
                      <span className="chip" key={marker} aria-label={`Marker: ${marker}`}>{marker}</span>
                    ))}
                    {treeData.markers.length > 8 && (
                      <span className="chip muted" aria-label={`Plus ${treeData.markers.length - 8} more markers`}>+{treeData.markers.length - 8} more</span>
                    )}
                  </div>
                )}
              </section>

              <section className="card ai-card" role="region" aria-labelledby="ai-insights-heading">
                <div className="card-header">
                  <h2 id="ai-insights-heading">AI Insights</h2>
                  <div className="ai-toolbar">
                    <select
                      className="ai-select"
                      value={aiModel}
                      onChange={(event) => setAiModel(event.target.value)}
                      disabled={aiModels.length === 0 || aiLoading}
                    >
                      {aiModels.length === 0 && <option value="">No models</option>}
                      {aiModels.map((model) => (
                        <option key={model} value={model}>{model}</option>
                      ))}
                    </select>
                    <button
                      className="ai-button"
                      onClick={() => treeData && runAiInsights(treeData)}
                      disabled={!treeData || aiModels.length === 0 || aiLoading}
                    >
                      {aiLoading ? 'Generating…' : 'Regenerate'}
                    </button>
                  </div>
                </div>
                {aiModels.length === 0 && (
                  <p className="muted">
                    Add `ALLOWED_MODELS` to the Cloudflare Worker to enable AI insights.
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
                  <div className="ai-grid">
                    <section className="ai-section">
                      <h3>Summary</h3>
                      <p>{String(aiInsight.summary || 'Not observed.')}</p>
                    </section>
                    <section className="ai-section">
                      <h3>Key Findings</h3>
                      {renderAiList(aiInsight.key_findings)}
                    </section>
                    <section className="ai-section">
                      <h3>Notable Populations</h3>
                      {renderAiList(aiInsight.notable_populations)}
                    </section>
                    <section className="ai-section">
                      <h3>Anomalies</h3>
                      {renderAiList(aiInsight.anomalies)}
                    </section>
                    <section className="ai-section">
                      <h3>Suggested Next Steps</h3>
                      {renderAiList(aiInsight.suggested_next_steps)}
                    </section>
                    <section className="ai-section">
                      <h3>Visualization Tips</h3>
                      {renderAiList(aiInsight.visualization_tips)}
                    </section>
                  </div>
                )}
                {!aiLoading && !aiError && !aiInsight && aiModels.length > 0 && (
                  <p className="muted">Insights will appear here after analysis finishes.</p>
                )}
              </section>

              {treeData.phenotypes && treeData.phenotypes.length > 0 && (
                <section className="card" role="region" aria-labelledby="phenotype-filter-heading">
                  <div className="card-header">
                    <h2 id="phenotype-filter-heading">Phenotype Filter</h2>
                    <span className="card-tag">{treeData.phenotypes.length} phenotypes</span>
                  </div>
                  <div className="button-grid" role="group" aria-label="Phenotype selection">
                    <button
                      onClick={() => setSelectedPhenotype(null)}
                      className={`tag-button ${selectedPhenotype === null ? 'active' : ''}`}
                      aria-pressed={selectedPhenotype === null}
                    >
                      All Cells ({treeData.cells})
                    </button>
                    {treeData.phenotypes.map((pheno) => (
                      <button
                        key={pheno.key}
                        onClick={() => setSelectedPhenotype(pheno.key)}
                        className={`tag-button ${selectedPhenotype === pheno.key ? 'active' : ''}`}
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
                <section className="card" role="region" aria-labelledby="gating-overview-heading">
                  <h2 id="gating-overview-heading">Gating Overview</h2>
                  <GatingOverview
                    cellData={treeData.cellData}
                    markers={treeData.markers || []}
                  />
                </section>
              )}

              {treeData.cellData && treeData.cellData.length > 0 && (
                <section className="card" role="region" aria-labelledby="interactive-cell-distribution-heading">
                  <div className="card-header">
                    <h2 id="interactive-cell-distribution-heading">Interactive Cell Distribution</h2>
                    <span className="card-tag">Scatter</span>
                  </div>
                  <CellScatter
                    cellData={treeData.cellData}
                    markers={treeData.markers || []}
                    phenotypes={treeData.phenotypes}
                    xMarker={scatterXMarker}
                    yMarker={scatterYMarker}
                    onMarkerChange={(x, y) => {
                      setScatterXMarker(x)
                      setScatterYMarker(y)
                    }}
                    selectedPopulation={
                      selectedPhenotype && treeData.phenotypes
                        ? treeData.phenotypes.find((p) => p.key === selectedPhenotype)?.population
                        : undefined
                    }
                  />
                </section>
              )}

              <section className="card" role="region" aria-labelledby="population-tree-heading">
                <h2 id="population-tree-heading">Population Tree</h2>
                <TreeViz
                  data={{
                    nodes: treeData.treeNodes && treeData.treeNodes.length > 0 ? treeData.treeNodes : treeData.nodes,
                    links: treeData.treeLinks && treeData.treeLinks.length > 0 ? treeData.treeLinks : treeData.links
                  }}
                />
              </section>
            </>
          )}
        </main>
      </div>
    </div>
  )
}

export default App
