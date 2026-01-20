import { useEffect, useMemo, useRef, useState } from "react";
import * as d3 from "d3";

type TreeNode = {
  id: number;
  name: string;
  marker: string;
  cells?: number;
  threshold?: number;
};

type TreeLink = {
  source: number;
  target: number;
};

type TreeData = {
  nodes: TreeNode[];
  links: TreeLink[];
};

type Props = {
  data: TreeData;
  onLeafNodeClick?: (populationId: number) => void;
};

type HierarchyNode = TreeNode & { children?: HierarchyNode[] };

const formatThreshold = (value: TreeNode["threshold"]) => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return ` ≤ ${value}`;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return ` ≤ ${parsed}`;
  }
  return "";
};

const resolveMarkerLabel = (node: TreeNode) => {
  if (typeof node.marker === "string" && node.marker.trim()) {
    return node.marker;
  }
  if (typeof node.name === "string" && node.name.trim()) {
    return node.name;
  }
  return "Node";
};

const parsePopulationId = (node: TreeNode): number | null => {
  const match = node.name.match(/^Pop_(\d+)$/);
  if (match) return Number(match[1]);
  return null;
};

const buildHierarchy = (data: TreeData): HierarchyNode | null => {
  if (!data.nodes.length) return null;
  const nodeMap = new Map<number, HierarchyNode>();
  const incoming = new Map<number, number>();

  for (const node of data.nodes) {
    nodeMap.set(node.id, { ...node });
    incoming.set(node.id, 0);
  }

  for (const link of data.links) {
    const parent = nodeMap.get(link.source);
    const child = nodeMap.get(link.target);
    if (!parent || !child) continue;
    if (!parent.children) parent.children = [];
    parent.children.push(child);
    incoming.set(child.id, (incoming.get(child.id) || 0) + 1);
  }

  const rootCandidates = Array.from(nodeMap.values()).filter(
    (node) => (incoming.get(node.id) || 0) === 0,
  );

  if (rootCandidates.length === 0) {
    return nodeMap.values().next().value ?? null;
  }

  if (rootCandidates.length === 1) return rootCandidates[0];

  return {
    id: 0,
    name: "Root",
    marker: "Root",
    children: rootCandidates,
  };
};

export default function TreeViz({ data, onLeafNodeClick }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [size, setSize] = useState({ width: 800, height: 520 });

  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      setSize({
        width: Math.max(520, Math.floor(entry.contentRect.width)),
        height: Math.max(420, Math.floor(entry.contentRect.height)),
      });
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  const hierarchy = useMemo(() => buildHierarchy(data), [data]);

  useEffect(() => {
    if (!svgRef.current || !hierarchy) return;

    const { width, height } = size;
    const margin = { top: 24, right: 24, bottom: 24, left: 24 };
    const innerWidth = width - margin.left - margin.right;
    const innerHeight = height - margin.top - margin.bottom;
    if (innerWidth <= 0 || innerHeight <= 0) return;

    const root = d3.hierarchy(hierarchy);
    const treeLayout = d3.tree<HierarchyNode>().size([innerHeight, innerWidth]);
    treeLayout(root);

    const svg = d3
      .select(svgRef.current)
      .attr("preserveAspectRatio", "xMinYMin meet")
      .attr("width", "100%")
      .attr("height", "100%");

    svg.selectAll("*").remove();

    const canvas = svg
      .append("g")
      .attr("transform", `translate(${margin.left},${margin.top})`);

    const linkGenerator = d3
      .linkHorizontal<d3.HierarchyPointLink<HierarchyNode>, d3.HierarchyPointNode<HierarchyNode>>()
      .x((d) => d.y)
      .y((d) => d.x);

    canvas
      .append("g")
      .attr("class", "tree-links")
      .selectAll("path")
      .data(root.links())
      .join("path")
      .attr("d", linkGenerator)
      .attr("fill", "none")
      .attr("stroke", "rgba(29, 27, 26, 0.25)")
      .attr("stroke-width", 1.6);

    const nodes = canvas
      .append("g")
      .attr("class", "tree-nodes")
      .selectAll("g")
      .data(root.descendants())
      .join("g")
      .attr("transform", (d) => `translate(${d.y},${d.x})`);

    nodes
      .append("circle")
      .attr("r", (d) => (d.children ? 7 : 6))
      .attr("fill", (d) => (d.children ? "#ff8a00" : "#06d6a0"))
      .attr("stroke", "rgba(29, 27, 26, 0.4)")
      .attr("stroke-width", 1.2)
      .style("cursor", (d) => (d.children ? "default" : "pointer"))
      .on("click", (_event, d) => {
        if (d.children) return;
        if (!onLeafNodeClick) return;
        const populationId = parsePopulationId(d.data);
        if (populationId !== null) onLeafNodeClick(populationId);
      });

    nodes
      .append("text")
      .attr("class", "tree-label")
      .attr("x", (d) => (d.children ? -10 : 10))
      .attr("text-anchor", (d) => (d.children ? "end" : "start"))
      .attr("dy", "0.35em")
      .text((d) => {
        if (!d.children) return d.data.name;
        const threshold = formatThreshold(d.data.threshold);
        return `${resolveMarkerLabel(d.data)}${threshold}`;
      });

    const canvasNode = canvas.node();
    if (canvasNode) {
      const bbox = canvasNode.getBBox();
      const pad = 24;
      const viewX = bbox.x + margin.left - pad;
      const viewY = bbox.y + margin.top - pad;
      const viewWidth = bbox.width + pad * 2;
      const viewHeight = bbox.height + pad * 2;
      svg.attr("viewBox", `${viewX} ${viewY} ${viewWidth} ${viewHeight}`);
    } else {
      svg.attr("viewBox", `0 0 ${width} ${height}`);
    }
  }, [hierarchy, onLeafNodeClick, size]);

  return (
    <div ref={containerRef} className="tree-viz">
      {hierarchy ? (
        <svg ref={svgRef} role="img" aria-label="CytomeTree gating tree" />
      ) : (
        <div className="tree-viz-empty">No gating tree data yet.</div>
      )}
    </div>
  );
}
