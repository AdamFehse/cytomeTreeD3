import { useEffect, useRef, useState } from 'react'
import * as d3 from 'd3'

interface Phenotype {
  key: string
  label: string
}

interface CellScatterProps {
  cellData: Array<Record<string, number>>
  markers: string[]
  phenotypes?: Phenotype[]
  xMarker: string
  yMarker: string
  onMarkerChange: (x: string, y: string) => void
  selectedPopulation?: number
}

const POPULATION_COLORS = [
  '#1f77b4', '#ff7f0e', '#2ca02c', '#d62728', '#9467bd',
  '#8c564b', '#e377c2', '#7f7f7f', '#bcbd22', '#17becf',
  '#aec7e8', '#ffbb78', '#98df8a', '#ff9896', '#c5b0d5',
]

export default function CellScatter({
  cellData,
  markers,
  phenotypes,
  xMarker,
  yMarker,
  onMarkerChange,
  selectedPopulation,
}: CellScatterProps) {
  const svgRef = useRef<SVGSVGElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [useMode, setUseMode] = useState<'marker' | 'phenotype_criteria'>('marker')
  const [xMarkerCriteria, setXMarkerCriteria] = useState<{ marker: string; value: 0 | 1 }>({
    marker: '',
    value: 1
  })
  const [yMarkerCriteria, setYMarkerCriteria] = useState<{ marker: string; value: 0 | 1 }>({
    marker: '',
    value: 1
  })

  // Initialize criteria when markers are available
  useEffect(() => {
    if (markers && markers.length > 0) {
      setXMarkerCriteria(prev => ({
        marker: markers.includes(prev.marker) ? prev.marker : (markers[0] || ''),
        value: prev.value
      }))
      setYMarkerCriteria(prev => ({
        marker: markers.includes(prev.marker) ? prev.marker : (markers[1] || markers[0] || ''),
        value: prev.value
      }))
    }
  }, [markers])

  useEffect(() => {
    if (!svgRef.current || !cellData || cellData.length === 0) return

    const margin = { top: 20, right: 20, bottom: 50, left: 60 }
    const width = Math.max(600, (containerRef.current?.clientWidth || 800) - 40)
    const height = 600

    // Clear previous
    d3.select(svgRef.current).selectAll("*").remove()

    const svg = d3.select(svgRef.current)
      .attr("width", width + margin.left + margin.right)
      .attr("height", height + margin.top + margin.bottom)
      .attr("aria-label", "Cell Distribution Scatter Plot")
      .attr("role", "img");

    const g = svg.append("g")
      .attr("transform", `translate(${margin.left},${margin.top})`)

    // Add background
    g.append("rect")
      .attr("width", width)
      .attr("height", height)
      .attr("fill", "#fafafa")

    // Extract x and y values based on axis type
    let processedData: Array<{ x: number; y: number; population: number }>
    let xLabel = xMarker
    let yLabel = yMarker

    if (useMode === 'phenotype_criteria') {
      // For phenotype criteria mode, create binary values (0/1) for single marker criteria
      processedData = cellData.map((d) => {
        // Check X axis criterion: does marker match expected value?
        const xCellVal = (d[xMarkerCriteria.marker] as number) || 0
        const xCellState = xCellVal > 0 ? 1 : 0
        const xMatch = xCellState === xMarkerCriteria.value ? 1 : 0

        // Check Y axis criterion: does marker match expected value?
        const yCellVal = (d[yMarkerCriteria.marker] as number) || 0
        const yCellState = yCellVal > 0 ? 1 : 0
        const yMatch = yCellState === yMarkerCriteria.value ? 1 : 0

        return {
          x: xMatch,
          y: yMatch,
          population: (d.population as number) || 0,
        }
      })

      xLabel = `${xMarkerCriteria.marker} = ${xMarkerCriteria.value}`
      yLabel = `${yMarkerCriteria.marker} = ${yMarkerCriteria.value}`
    } else {
      // Original marker mode
      processedData = cellData.map((d) => ({
        x: (d[xMarker] as number) || 0,
        y: (d[yMarker] as number) || 0,
        population: (d.population as number) || 0,
      }))
    }

    // Create scales
    const xExtent =
      useMode === 'phenotype_criteria'
        ? [0, 1]
        : (d3.extent(processedData, (d) => d.x) as [number, number])
    const yExtent =
      useMode === 'phenotype_criteria'
        ? [0, 1]
        : (d3.extent(processedData, (d) => d.y) as [number, number])

    const xScale = d3
      .scaleLinear()
      .domain(
        useMode === 'phenotype_criteria'
          ? [-0.5, 1.5]
          : [
              xExtent[0] - 0.05 * (xExtent[1] - xExtent[0]),
              xExtent[1] + 0.05 * (xExtent[1] - xExtent[0]),
            ]
      )
      .range([0, width])

    const yScale = d3
      .scaleLinear()
      .domain(
        useMode === 'phenotype_criteria'
          ? [-0.5, 1.5]
          : [
              yExtent[0] - 0.05 * (yExtent[1] - yExtent[0]),
              yExtent[1] + 0.05 * (yExtent[1] - yExtent[0]),
            ]
      )
      .range([height, 0])

    // Plot cells
    g.selectAll(".cell")
      .data(processedData)
      .join("circle")
      .attr("class", "cell")
      .attr("cx", (d) => xScale(d.x))
      .attr("cy", (d) => yScale(d.y))
      .attr("r", useMode === 'phenotype_criteria' ? 4 : 2)
      .attr("fill", (d) => {
        if (selectedPopulation !== undefined && d.population !== selectedPopulation) {
          return '#ccc'
        }
        return POPULATION_COLORS[d.population % POPULATION_COLORS.length]
      })
      .attr("opacity", (d) => {
        if (selectedPopulation !== undefined && d.population !== selectedPopulation) {
          return 0.1
        }
        return useMode === 'phenotype_criteria' ? 0.5 : 0.6
      })
      .attr("aria-label", (d: any) => `Cell at (${d.x.toFixed(2)}, ${d.y.toFixed(2)}), Population: ${d.population}`)
      .attr("role", "img");

    // Add X axis
    const xAxis = d3.axisBottom(xScale)
    g.append("g")
      .attr("transform", `translate(0,${height})`)
      .call(xAxis)

    // Add Y axis
    const yAxis = d3.axisLeft(yScale)
    g.append("g")
      .call(yAxis)

    // Add X label
    g.append("text")
      .attr("transform", `translate(${width / 2},${height + 40})`)
      .attr("text-anchor", "middle")
      .attr("font-size", 12)
      .text(xLabel)
      .attr("aria-hidden", "true"); // Hide from screen readers since it's redundant

    // Add Y label
    g.append("text")
      .attr("transform", "rotate(-90)")
      .attr("y", -45)
      .attr("x", -(height / 2))
      .attr("text-anchor", "middle")
      .attr("font-size", 12)
      .text(yLabel)
      .attr("aria-hidden", "true"); // Hide from screen readers since it's redundant

    // Add title
    svg.append("text")
      .attr("x", width / 2 + margin.left)
      .attr("y", 15)
      .attr("text-anchor", "middle")
      .attr("font-size", 14)
      .attr("font-weight", "bold")
      .text(
        useMode === 'phenotype_criteria'
          ? `Phenotype Criteria: ${xLabel} vs ${yLabel}`
          : `Cell Distribution: ${xLabel} vs ${yLabel}`
      )
      .attr("aria-hidden", "true"); // Hide from screen readers since it's redundant
  }, [cellData, xMarker, yMarker, selectedPopulation, useMode, xMarkerCriteria, yMarkerCriteria])

  return (
    <div ref={containerRef} style={{ width: '100%' }}>
      <div style={{ marginBottom: '15px' }}>
        <div style={{ marginBottom: '10px' }}>
          <label style={{ marginRight: '20px' }}>
            <input
              type="radio"
              name="axisType"
              value="marker"
              checked={useMode === 'marker'}
              onChange={() => setUseMode('marker')}
              aria-label="Use marker axes"
            />
            {' '}Marker Axes
          </label>
          <label>
            <input
              type="radio"
              name="axisType"
              value="phenotype_criteria"
              checked={useMode === 'phenotype_criteria'}
              onChange={() => setUseMode('phenotype_criteria')}
              aria-label="Use phenotype criteria"
            />
            {' '}Phenotype Criteria
          </label>
        </div>

        {useMode === 'marker' ? (
          <>
            <label style={{ marginRight: '20px' }}>
              X Axis:
              <select
                value={xMarker}
                onChange={(e) => onMarkerChange(e.target.value, yMarker)}
                style={{ marginLeft: '8px', padding: '4px' }}
                aria-label="Select X-axis marker"
              >
                {markers.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Y Axis:
              <select
                value={yMarker}
                onChange={(e) => onMarkerChange(xMarker, e.target.value)}
                style={{ marginLeft: '8px', padding: '4px' }}
                aria-label="Select Y-axis marker"
              >
                {markers.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </label>
          </>
        ) : markers && markers.length > 0 ? (
          <>
            <div style={{ marginBottom: '10px' }}>
              <label style={{ marginRight: '20px' }}>
                X Axis Marker:
                <select
                  value={xMarkerCriteria.marker || ''}
                  onChange={(e) => setXMarkerCriteria({ ...xMarkerCriteria, marker: e.target.value })}
                  style={{ marginLeft: '8px', padding: '4px' }}
                  aria-label="Select X-axis marker for phenotype criteria"
                >
                  <option value="">Select marker</option>
                  {markers.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Value:
                <select
                  value={xMarkerCriteria.value.toString()}
                  onChange={(e) => setXMarkerCriteria({ ...xMarkerCriteria, value: parseInt(e.target.value) as 0 | 1 })}
                  style={{ marginLeft: '8px', padding: '4px' }}
                  aria-label="Select X-axis value for phenotype criteria"
                >
                  <option value="0">0 (Negative)</option>
                  <option value="1">1 (Positive)</option>
                </select>
              </label>
            </div>
            <div>
              <label style={{ marginRight: '20px' }}>
                Y Axis Marker:
                <select
                  value={yMarkerCriteria.marker || ''}
                  onChange={(e) => setYMarkerCriteria({ ...yMarkerCriteria, marker: e.target.value })}
                  style={{ marginLeft: '8px', padding: '4px' }}
                  aria-label="Select Y-axis marker for phenotype criteria"
                >
                  <option value="">Select marker</option>
                  {markers.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Value:
                <select
                  value={yMarkerCriteria.value.toString()}
                  onChange={(e) => setYMarkerCriteria({ ...yMarkerCriteria, value: parseInt(e.target.value) as 0 | 1 })}
                  style={{ marginLeft: '8px', padding: '4px' }}
                  aria-label="Select Y-axis value for phenotype criteria"
                >
                  <option value="0">0 (Negative)</option>
                  <option value="1">1 (Positive)</option>
                </select>
              </label>
            </div>
          </>
        ) : (
          <div style={{ padding: '10px', color: '#666' }}>
            <em>Load data to enable phenotype criteria mode</em>
          </div>
        )}
      </div>
      <svg
        ref={svgRef}
        style={{ border: '1px solid #ddd', borderRadius: '5px' }}
        aria-label="Cell distribution scatter plot showing relationship between markers"
        role="img"
      />

      {/* Legend */}
      <div style={{ marginTop: '15px', display: 'flex', flexWrap: 'wrap', gap: '15px' }} aria-label="Population legend">
        {Array.from(new Set(cellData.map((d) => (d.population as number) || 0))).sort((a, b) => a - b).map((popId) => (
          <div key={popId} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <div
              style={{
                width: '16px',
                height: '16px',
                backgroundColor: POPULATION_COLORS[popId % POPULATION_COLORS.length],
                borderRadius: '2px',
              }}
              aria-label={`Population ${popId} color indicator`}
              role="img"
            />
            <span style={{ fontSize: '13px', color: '#333' }}>Population {popId}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
