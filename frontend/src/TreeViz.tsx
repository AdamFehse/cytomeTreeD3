import { useEffect, useRef } from 'react'
import * as d3 from 'd3'

interface Node {
  id: number
  name: string
  marker: string
  cells?: number
}

interface Link {
  source: number
  target: number
}

interface TreeData {
  nodes: Node[]
  links: Link[]
}

export default function TreeViz({ data }: { data: TreeData }) {
  const svgRef = useRef<SVGSVGElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!svgRef.current || !data || !containerRef.current) return

    const width = Math.max(1000, containerRef.current.clientWidth - 20)
    const height = 700

    // Clear previous
    d3.select(svgRef.current).selectAll("*").remove()

    const svg = d3.select(svgRef.current)
      .attr("width", width)
      .attr("height", height)

    // Add background
    svg.append("rect")
      .attr("width", width)
      .attr("height", height)
      .attr("fill", "#f9f9f9")

    // Create a group for zooming
    const g = svg.append("g")

    // Create simulation with better parameters
    const simulation = d3.forceSimulation(data.nodes as any)
      .force("link", d3.forceLink(data.links).id((d: any) => d.id).distance(60))
      .force("charge", d3.forceManyBody().strength(-200))
      .force("center", d3.forceCenter(width / 2, height / 2))
      .force("collide", d3.forceCollide((d: any) => {
        // Node size based on cell count, or 12 if no data
        const cellCount = (d as any).cells || 100
        return Math.sqrt(cellCount / Math.PI) / 3 + 15
      }).iterations(2))

    // Draw links
    const link = g.append("g")
      .selectAll("line")
      .data(data.links)
      .join("line")
      .attr("stroke", "#ddd")
      .attr("stroke-width", 1.5)

    // Draw nodes
    const node = g.append("g")
      .selectAll("circle")
      .data(data.nodes)
      .join("circle")
      .attr("r", (d: any) => {
        // Size nodes based on cell count
        const cellCount = (d as any).cells || 100
        return Math.sqrt(cellCount / Math.PI) / 3 + 5
      })
      .attr("fill", "#69b3a2")
      .attr("stroke", "#fff")
      .attr("stroke-width", 2)

    // Add labels
    const label = g.append("g")
      .selectAll("text")
      .data(data.nodes)
      .join("text")
      .text((d) => d.name)
      .attr("font-size", 11)
      .attr("text-anchor", "start")
      .attr("dx", (d: any) => {
        const cellCount = (d as any).cells || 100
        return Math.sqrt(cellCount / Math.PI) / 3 + 10
      })
      .attr("dy", 4)
      .attr("fill", "#333")

    // Update positions on tick
    simulation.on("tick", () => {
      link
        .attr("x1", (d: any) => Math.max(0, Math.min(width, d.source.x)))
        .attr("y1", (d: any) => Math.max(0, Math.min(height, d.source.y)))
        .attr("x2", (d: any) => Math.max(0, Math.min(width, d.target.x)))
        .attr("y2", (d: any) => Math.max(0, Math.min(height, d.target.y)))

      node
        .attr("cx", (d: any) => {
          d.x = Math.max(10, Math.min(width - 10, d.x))
          return d.x
        })
        .attr("cy", (d: any) => {
          d.y = Math.max(10, Math.min(height - 10, d.y))
          return d.y
        })

      label
        .attr("x", (d: any) => d.x)
        .attr("y", (d: any) => d.y)
    })

    // Add zoom behavior
    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .on("zoom", (event) => {
        g.attr("transform", event.transform)
      })

    svg.call(zoom)

    // Return cleanup
    return () => {
      simulation.stop()
    }
  }, [data])

  return (
    <div ref={containerRef} style={{ width: '100%', overflow: 'hidden' }}>
      <div style={{ marginBottom: '10px' }}>
        <small style={{ color: '#666' }}>Scroll to zoom, drag to pan. Node size = cell count</small>
      </div>
      <svg
        ref={svgRef}
        style={{
          border: '1px solid #ddd',
          borderRadius: '5px',
          display: 'block'
        }}
      />
    </div>
  )
}
