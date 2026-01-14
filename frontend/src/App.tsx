import { useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import './App.css'
import TreeViz from './TreeViz'
import CellScatter from './CellScatter'
import GatingOverview from './GatingOverview'

const DAD_JOKES = [
  "Why don't scientists trust atoms? Because they make up everything!",
  "What do you call a fake noodle? An impasta!",
  "Why did the scarecrow win an award? He was outstanding in his field!",
  "What do you call a bear with no teeth? A gummy bear!",
  "Why don't eggs tell jokes? They'd crack each other up!",
]

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
  const [error, setError] = useState<string | null>(null)
  const [threshold, setThreshold] = useState(0.1)
  const [selectedFiles, setSelectedFiles] = useState<FileList | null>(null)
  const [scatterXMarker, setScatterXMarker] = useState<string>('')
  const [scatterYMarker, setScatterYMarker] = useState<string>('')
  const [selectedPhenotype, setSelectedPhenotype] = useState<string | null>(null)
  const [progress, setProgress] = useState(0)
  const progressTimerRef = useRef<number | null>(null)

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

  const handleAnalyze = async () => {
    if (!selectedFiles || selectedFiles.length === 0) {
      setError('Please select at least one FCS file')
      return
    }

    setAnalyzing(true)
    setError(null)
    setProgress(0)
    setJoke(DAD_JOKES[Math.floor(Math.random() * DAD_JOKES.length)])

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
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
      console.error('Analysis error:', err)
    } finally {
      if (progressTimerRef.current) {
        window.clearInterval(progressTimerRef.current)
        progressTimerRef.current = null
      }
      setAnalyzing(false)
    }
  }

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
                <span className="progress-label">{progress}%</span>
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
