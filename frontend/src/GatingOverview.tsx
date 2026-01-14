import { useEffect, useRef, useState } from 'react'
import * as d3 from 'd3'

interface GatingOverviewProps {
  cellData: Array<Record<string, number>>
  markers: string[]
  markerCombinations?: Array<[string, string]>
}

const POPULATION_COLORS = [
  '#1f77b4', '#ff7f0e', '#2ca02c', '#d62728', '#9467bd',
  '#8c564b', '#e377c2', '#7f7f7f', '#bcbd22', '#17becf',
  '#aec7e8', '#ffbb78', '#98df8a', '#ff9896', '#c5b0d5',
]

export default function GatingOverview({
  cellData,
  markers,
  markerCombinations,
}: GatingOverviewProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [visiblePopulations, setVisiblePopulations] = useState<Set<number>>(
    new Set(Array.from(new Set(cellData.map((d) => (d.population as number) || 0))))
  )

  const togglePopulation = (popId: number) => {
    setVisiblePopulations((prev) => {
      const next = new Set(prev)
      if (next.has(popId)) {
        next.delete(popId)
      } else {
        next.add(popId)
      }
      return next
    })
  }

  // Default combinations if not provided
  // Filter to fluorescence markers (exclude FS, SS) and create combinations
  const fluorescenceMarkers = markers.filter(
    (m) => !m.toUpperCase().startsWith('FS') && !m.toUpperCase().startsWith('SS')
  )

  const combinations = markerCombinations || fluorescenceMarkers.length >= 2
    ? [
        [fluorescenceMarkers[0], fluorescenceMarkers[1]],
        [fluorescenceMarkers[0], fluorescenceMarkers[2] || fluorescenceMarkers[1]],
        [fluorescenceMarkers[1], fluorescenceMarkers[2] || fluorescenceMarkers[1]],
      ]
        .filter(([x, y]) => x && y && x !== y)
        .slice(0, 3) // Show max 3 combinations
    : (markers.slice(0, 3) as any[])

  useEffect(() => {
    if (!containerRef.current || !cellData || cellData.length === 0) return

    const width = 350
    const height = 350
    const margin = { top: 20, right: 20, bottom: 40, left: 50 }
    const plotWidth = width - margin.left - margin.right
    const plotHeight = height - margin.top - margin.bottom

    // Clear previous
    d3.select(containerRef.current).selectAll('svg').remove()

    combinations.forEach(([xMarker, yMarker]) => {
      // Process data
      const processedData = cellData.map((d) => ({
        x: (d[xMarker] as number) || 0,
        y: (d[yMarker] as number) || 0,
        population: (d.population as number) || 0,
      }))

      // Calculate extents
      const xExtent = d3.extent(processedData, (d) => d.x) as [number, number]
      const yExtent = d3.extent(processedData, (d) => d.y) as [number, number]

      // Create scales
      const xScale = d3
        .scaleLinear()
        .domain([
          xExtent[0] - 0.05 * (xExtent[1] - xExtent[0]),
          xExtent[1] + 0.05 * (xExtent[1] - xExtent[0]),
        ])
        .range([0, plotWidth])

      const yScale = d3
        .scaleLinear()
        .domain([
          yExtent[0] - 0.05 * (yExtent[1] - yExtent[0]),
          yExtent[1] + 0.05 * (yExtent[1] - yExtent[0]),
        ])
        .range([plotHeight, 0])

      // Create SVG
      const svg = d3
        .select(containerRef.current)
        .append('svg')
        .attr('width', width)
        .attr('height', height)
        .style('display', 'inline-block')
        .style('margin', '10px')
        .style('border', '1px solid #ddd')
        .style('borderRadius', '5px')
        .attr('aria-label', `${xMarker} vs ${yMarker} scatter plot`)
        .attr('role', 'img');

      // Add background
      svg.append('rect').attr('width', width).attr('height', height).attr('fill', '#fafafa')

      // Create group
      const g = svg
        .append('g')
        .attr('transform', `translate(${margin.left},${margin.top})`)

      // Plot cells
      g.selectAll('.cell')
        .data(processedData)
        .join('circle')
        .attr('class', 'cell')
        .attr('cx', (d) => xScale(d.x))
        .attr('cy', (d) => yScale(d.y))
        .attr('r', 1.5)
        .attr('fill', (d) => POPULATION_COLORS[d.population % POPULATION_COLORS.length])
        .attr('opacity', (d) => visiblePopulations.has(d.population) ? 0.6 : 0.05)
        .attr('aria-label', (d: any) => `Cell at (${d.x.toFixed(2)}, ${d.y.toFixed(2)}), Population: ${d.population}`)
        .attr('role', 'img');

      // Add X axis
      const xAxis = d3.axisBottom(xScale).ticks(4)
      g.append('g')
        .attr('transform', `translate(0,${plotHeight})`)
        .call(xAxis)
        .attr('font-size', '10px')

      // Add Y axis
      const yAxis = d3.axisLeft(yScale).ticks(4)
      g.append('g').call(yAxis).attr('font-size', '10px')

      // Add X label
      g.append('text')
        .attr('transform', `translate(${plotWidth / 2},${plotHeight + 35})`)
        .attr('text-anchor', 'middle')
        .attr('font-size', '11px')
        .text(xMarker)
        .attr('aria-hidden', 'true'); // Hide from screen readers since it's redundant

      // Add Y label
      g.append('text')
        .attr('transform', 'rotate(-90)')
        .attr('y', -40)
        .attr('x', -(plotHeight / 2))
        .attr('text-anchor', 'middle')
        .attr('font-size', '11px')
        .text(yMarker)
        .attr('aria-hidden', 'true'); // Hide from screen readers since it's redundant

      // Add title
      svg.append('text')
        .attr('x', width / 2)
        .attr('y', 15)
        .attr('text-anchor', 'middle')
        .attr('font-size', '12px')
        .attr('font-weight', 'bold')
        .text(`${xMarker} vs ${yMarker}`)
        .attr('aria-hidden', 'true'); // Hide from screen readers since it's redundant
    })
  }, [cellData, markers, combinations, visiblePopulations])

  return (
    <div style={{ marginBottom: '30px' }}>
      <h3>Automated Gating Overview</h3>
      <p style={{ color: '#666', fontSize: '13px' }}>
        Each plot shows cells colored by their assigned population from CytomeTree automatic gating
      </p>
      <div
        ref={containerRef}
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: '10px',
        }}
        aria-label="Gating overview plots"
      />

      {/* Interactive Legend */}
      <div style={{ marginTop: '15px' }}>
        <p style={{ fontSize: '12px', color: '#666', marginBottom: '10px' }}>
          Click populations to toggle visibility:
        </p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px' }} role="group" aria-label="Population visibility toggles">
          {Array.from(new Set(cellData.map((d) => (d.population as number) || 0)))
            .sort((a, b) => a - b)
            .map((popId) => (
              <button
                key={popId}
                onClick={() => togglePopulation(popId)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '6px 12px',
                  backgroundColor: visiblePopulations.has(popId) ? '#f0f0f0' : '#e8e8e8',
                  border: `2px solid ${POPULATION_COLORS[popId % POPULATION_COLORS.length]}`,
                  borderRadius: '4px',
                  cursor: 'pointer',
                  opacity: visiblePopulations.has(popId) ? 1 : 0.5,
                  transition: 'all 0.2s',
                }}
                aria-pressed={!visiblePopulations.has(popId)}
                aria-label={`Toggle visibility for population ${popId}`}
              >
                <div
                  style={{
                    width: '14px',
                    height: '14px',
                    backgroundColor: POPULATION_COLORS[popId % POPULATION_COLORS.length],
                    borderRadius: '2px',
                  }}
                  aria-hidden="true"
                />
                <span style={{ fontSize: '12px', color: '#333', fontWeight: '500' }}>
                  Population {popId}
                </span>
              </button>
            ))}
        </div>
      </div>
    </div>
  )
}
