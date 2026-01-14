import { useState } from 'react'
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
      }

      // Send to batch endpoint
      const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:8000'
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
      setAnalyzing(false)
    }
  }

  return (
    <div style={{ padding: '20px', fontFamily: 'sans-serif' }}>
      <h1>CytoTree Explorer</h1>
      <div style={{ marginBottom: '20px', padding: '15px', backgroundColor: '#f5f5f5', borderRadius: '5px' }}>
        <div style={{ marginBottom: '15px' }}>
          <label style={{ display: 'block', marginBottom: '10px' }}>
            <strong>Select FCS Files:</strong>
            <input
              type="file"
              multiple
              accept=".fcs"
              onChange={handleFileSelect}
              disabled={analyzing}
              style={{ marginLeft: '10px', display: 'block', marginTop: '5px' }}
            />
          </label>
          {selectedFiles && selectedFiles.length > 0 && (
            <p style={{ margin: '10px 0', color: '#666' }}>
              {selectedFiles.length} file(s) selected
            </p>
          )}
        </div>

        <div style={{ marginBottom: '15px' }}>
          <label style={{ display: 'block' }}>
            Threshold (t): {threshold.toFixed(2)}
            <input
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={threshold}
              onChange={(e) => setThreshold(parseFloat(e.target.value))}
              disabled={analyzing}
              style={{ marginLeft: '10px', width: '200px' }}
            />
          </label>
        </div>

        <button
          onClick={handleAnalyze}
          disabled={analyzing || !selectedFiles || selectedFiles.length === 0}
          style={{
            padding: '10px 20px',
            fontSize: '16px',
            backgroundColor:
              analyzing || !selectedFiles || selectedFiles.length === 0
                ? '#ccc'
                : '#4CAF50',
            color: 'white',
            border: 'none',
            borderRadius: '5px',
            cursor:
              analyzing || !selectedFiles || selectedFiles.length === 0
                ? 'not-allowed'
                : 'pointer'
          }}
        >
          {analyzing ? 'Analyzing...' : 'Analyze'}
        </button>
      </div>

      {analyzing && <p style={{ fontStyle: 'italic', color: '#666' }}>{joke}</p>}
      {error && <p style={{ color: 'red' }}>Error: {error}</p>}
      {treeData && (
        <div>
          <div style={{ marginBottom: '20px', padding: '15px', backgroundColor: '#e8f5e9', borderRadius: '5px' }}>
            <h3 style={{ margin: '0 0 10px 0' }}>Analysis Results</h3>
            <p style={{ margin: '5px 0' }}>
              <strong>Total Cells:</strong> {treeData.cells} | <strong>Populations:</strong> {treeData.populations}
            </p>
            {treeData.markers && treeData.markers.length > 0 && (
              <p style={{ margin: '5px 0' }}>
                <strong>Markers Used:</strong> {treeData.markers.join(', ')}
              </p>
            )}
            {treeData.nodes && treeData.nodes.length > 0 && (
              <div style={{ marginTop: '10px', fontSize: '12px', color: '#555' }}>
                <p style={{ margin: '5px 0', fontWeight: 'bold' }}>Population Breakdown:</p>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: '8px' }}>
                  {treeData.nodes.map((node) => (
                    <div key={node.id} style={{ padding: '6px', backgroundColor: '#fff', borderRadius: '3px', border: '1px solid #ccc' }}>
                      <div style={{ fontWeight: 'bold' }}>{node.name}</div>
                      <div>{node.cells} cells</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {treeData.phenotypes && treeData.phenotypes.length > 0 && (
            <div style={{ marginBottom: '20px', padding: '15px', backgroundColor: '#f0f8ff', borderRadius: '5px' }}>
              <h3 style={{ margin: '0 0 10px 0' }}>Select Phenotype</h3>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '8px' }}>
                <button
                  onClick={() => setSelectedPhenotype(null)}
                  style={{
                    padding: '8px 12px',
                    backgroundColor: selectedPhenotype === null ? '#4CAF50' : '#e0e0e0',
                    color: selectedPhenotype === null ? 'white' : 'black',
                    border: 'none',
                    borderRadius: '4px',
                    cursor: 'pointer',
                  }}
                >
                  All Cells ({treeData.cells})
                </button>
                {treeData.phenotypes.map((pheno) => (
                  <button
                    key={pheno.key}
                    onClick={() => setSelectedPhenotype(pheno.key)}
                    style={{
                      padding: '8px 12px',
                      backgroundColor: selectedPhenotype === pheno.key ? '#4CAF50' : '#e0e0e0',
                      color: selectedPhenotype === pheno.key ? 'white' : 'black',
                      border: 'none',
                      borderRadius: '4px',
                      cursor: 'pointer',
                      fontSize: '12px',
                    }}
                    title={`${pheno.count} cells (${(pheno.proportion * 100).toFixed(1)}%)`}
                  >
                    {pheno.label} ({(pheno.proportion * 100).toFixed(1)}%)
                  </button>
                ))}
              </div>
            </div>
          )}

          {treeData.cellData && treeData.cellData.length > 0 && (
            <GatingOverview
              cellData={treeData.cellData}
              markers={treeData.markers || []}
            />
          )}

          {treeData.cellData && treeData.cellData.length > 0 && (
            <div style={{ marginBottom: '30px' }}>
              <h3>Interactive Cell Distribution</h3>
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
            </div>
          )}

          <div>
            <h3>Population Tree</h3>
            <TreeViz data={treeData} />
          </div>
        </div>
      )}
    </div>
  )
}

export default App
