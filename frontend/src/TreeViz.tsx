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
      .attr("aria-label", "Population Tree Visualization")
      .attr("role", "img");

    // Add background
    svg.append("rect")
      .attr("width", width)
      .attr("height", height)
      .attr("fill", "#f9f9f9")

    // Create a group for zooming
    const g = svg.append("g")

    const hasLinks = data.links && data.links.length > 0

    if (hasLinks) {
      const nodesById = new Map<number, Node>()
      data.nodes.forEach((node) => nodesById.set(node.id, node))

      const childrenById = new Map<number, number[]>()
      const targetIds = new Set<number>()
      data.links.forEach((link) => {
        const sourceId = typeof link.source === "number" ? link.source : (link.source as any).id
        const targetId = typeof link.target === "number" ? link.target : (link.target as any).id
        if (!childrenById.has(sourceId)) {
          childrenById.set(sourceId, [])
        }
        childrenById.get(sourceId)?.push(targetId)
        targetIds.add(targetId)
      })

      const rootId = data.nodes.find((node) => !targetIds.has(node.id))?.id ?? data.nodes[0]?.id
      const buildHierarchy = (id: number): any => ({
        ...nodesById.get(id),
        children: (childrenById.get(id) || []).map(buildHierarchy)
      })

      const root = d3.hierarchy(buildHierarchy(rootId))
      const margin = { top: 40, right: 40, bottom: 40, left: 40 }
      const treeLayout = d3.tree<any>().size([width - margin.left - margin.right, height - margin.top - margin.bottom])
      treeLayout(root)

      const linkPath = d3.linkVertical()
        .x((d: any) => d.x + margin.left)
        .y((d: any) => d.y + margin.top)

      g.append("g")
        .selectAll("path")
        .data(root.links())
        .join("path")
        .attr("d", linkPath as any)
        .attr("fill", "none")
        .attr("stroke", "#c9c9c9")
        .attr("stroke-width", 1.4)
        .attr("aria-label", (d: any) => `Connection from node ${d.source.data.id} to node ${d.target.data.id}`)

      const node = g.append("g")
        .selectAll("circle")
        .data(root.descendants())
        .join("circle")
        .attr("cx", (d: any) => d.x + margin.left)
        .attr("cy", (d: any) => d.y + margin.top)
        .attr("r", (d: any) => {
          const cellCount = d.data.cells || 100
          return Math.sqrt(cellCount / Math.PI) / 3 + 5
        })
        .attr("fill", "#69b3a2")
        .attr("stroke", "#fff")
        .attr("stroke-width", 2)
        .attr("aria-label", (d: any) => `Population: ${d.data.name}, Cells: ${d.data.cells || 0}`)
        .attr("role", "img")

      g.append("g")
        .selectAll("text")
        .data(root.descendants())
        .join("text")
        .text((d: any) => d.data.marker || d.data.name)
        .attr("x", (d: any) => d.x + margin.left)
        .attr("y", (d: any) => d.y + margin.top)
        .attr("font-size", 11)
        .attr("text-anchor", "start")
        .attr("dx", (d: any) => {
          const cellCount = d.data.cells || 100
          return Math.sqrt(cellCount / Math.PI) / 3 + 10
        })
        .attr("dy", 4)
        .attr("fill", "#333")
        .attr("aria-hidden", "true")

      const zoom = d3.zoom<SVGSVGElement, unknown>()
        .on("zoom", (event) => {
          g.attr("transform", event.transform)
        })

      svg.call(zoom)
      return
    }

    // Fall back to a force layout when no links are available
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
      .attr("aria-label", (d: any) => `Connection from node ${d.source.id} to node ${d.target.id}`);

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
      .attr("aria-label", (d: any) => `Population: ${d.name}, Cells: ${d.cells || 0}`)
      .attr("role", "img");

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
      .attr("aria-hidden", "true"); // Hide labels from screen readers since they're redundant

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
        aria-label="Population Tree Visualization showing relationships between cell populations"
        role="img"
      />
    </div>
  )
}
