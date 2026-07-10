#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

// Paths relative to project root
const GRAPH_PATH = path.resolve('graphify-out/graph.json');
const COMPLIANCE_DIR = 'src/modules/compliance/v8/';
const OPTIMIZER_DIR = 'optimizer-service/';

// Helper to normalize file paths
function normalizePath(filePath) {
  if (!filePath) return '';
  let p = filePath.replace(/\\/g, '/');
  
  // Strip capstone prefix if any
  const capstonePrefix = 'capstone-project-26t1-3900-f10a-date/frontend/';
  if (p.startsWith(capstonePrefix)) {
    p = p.substring(capstonePrefix.length);
  }
  
  // If it starts with a leading slash, remove it
  if (p.startsWith('/')) {
    p = p.substring(1);
  }
  
  return p;
}

// Get modified files
function getModifiedFiles() {
  const args = process.argv.slice(2);
  if (args.length > 0) {
    return args.map(f => normalizePath(f));
  }

  // Fallback to git
  try {
    const diff = execSync('git diff --name-only HEAD', { encoding: 'utf8' });
    const cached = execSync('git diff --cached --name-only', { encoding: 'utf8' });
    const untracked = execSync('git ls-files --others --exclude-standard', { encoding: 'utf8' });
    
    const files = new Set([
      ...diff.split('\n'),
      ...cached.split('\n'),
      ...untracked.split('\n')
    ].map(f => normalizePath(f.trim())).filter(Boolean));
    
    return Array.from(files);
  } catch (e) {
    console.error('Warning: Git diff failed, please specify files manually.');
    return [];
  }
}

// Load graph
if (!fs.existsSync(GRAPH_PATH)) {
  console.error(`Error: graph.json not found at ${GRAPH_PATH}. Please run graphify first.`);
  process.exit(1);
}

const graph = JSON.parse(fs.readFileSync(GRAPH_PATH, 'utf8'));

// Build maps
const nodesMap = new Map(); // id -> node
const fileToNodes = new Map(); // normalized_file -> Set<node>
const parentToChildren = new Map(); // target_id -> Set<link> (who depends on target)

for (const node of graph.nodes) {
  nodesMap.set(node.id, node);
  const normalizedFile = normalizePath(node.source_file);
  if (normalizedFile) {
    if (!fileToNodes.has(normalizedFile)) {
      fileToNodes.set(normalizedFile, new Set());
    }
    fileToNodes.get(normalizedFile).add(node);
  }
}

// Dependency relations that propagate changes downstream:
// target is the dependency, source is the dependent.
const DEPENDENCY_RELATIONS = new Set(['calls', 'inherits', 'uses', 'imports_from', 'imports']);

for (const link of graph.links) {
  if (DEPENDENCY_RELATIONS.has(link.relation)) {
    if (!parentToChildren.has(link.target)) {
      parentToChildren.set(link.target, new Set());
    }
    parentToChildren.get(link.target).add(link);
  }
}

const changedFiles = getModifiedFiles();
if (changedFiles.length === 0) {
  console.log('No modified files detected.');
  process.exit(0);
}

console.log('\n### Modified Files');
changedFiles.forEach(f => console.log(`- \`${f}\``));

// Parity Check: V8 compliance vs Optimizer
let hasComplianceChanges = false;
let hasOptimizerChanges = false;

for (const file of changedFiles) {
  if (file.startsWith(COMPLIANCE_DIR)) {
    hasComplianceChanges = true;
  }
  if (file.startsWith(OPTIMIZER_DIR)) {
    hasOptimizerChanges = true;
  }
}

// Tracing impacts
const queue = [];
const visitedNodes = new Set();
const impactedFiles = new Map(); // file -> Array of { node, path, relation }

// Seed queue with nodes belonging to changed files
for (const file of changedFiles) {
  const nodes = fileToNodes.get(file);
  if (nodes) {
    for (const node of nodes) {
      queue.push({
        node,
        depth: 0,
        path: [node.label]
      });
      visitedNodes.add(node.id);
    }
  }
}

const MAX_DEPTH = 3;

while (queue.length > 0) {
  const { node, depth, path } = queue.shift();
  if (depth >= MAX_DEPTH) continue;

  const childLinks = parentToChildren.get(node.id);
  if (childLinks) {
    for (const link of childLinks) {
      const childNode = nodesMap.get(link.source);
      if (!childNode) continue;
      
      if (!visitedNodes.has(childNode.id)) {
        visitedNodes.add(childNode.id);
        
        const childFile = normalizePath(childNode.source_file);
        const nodeFile = normalizePath(node.source_file);
        
        // If the dependent node is in a different file, record the file impact
        if (childFile && childFile !== nodeFile && !changedFiles.includes(childFile)) {
          if (!impactedFiles.has(childFile)) {
            impactedFiles.set(childFile, []);
          }
          impactedFiles.get(childFile).push({
            node: childNode,
            path: [...path, childNode.label],
            relation: link.relation,
            depth: depth + 1
          });
        }
        
        queue.push({
          node: childNode,
          depth: depth + 1,
          path: [...path, childNode.label]
        });
      }
    }
  }
}

console.log('\n### Downstream Impact Analysis');

if (hasComplianceChanges && !hasOptimizerChanges) {
  console.log('\n> [!WARNING]');
  console.log('> **Compliance Rule Parity warning**:');
  console.log(`> Changes detected in TypeScript compliance auditor (\`${COMPLIANCE_DIR}\`) but NOT in Python optimizer-service (\`${OPTIMIZER_DIR}\`).`);
  console.log('> Remember that the CP-SAT solver and V8 compliance auditor must agree on every rule.');
} else if (hasOptimizerChanges && !hasComplianceChanges) {
  console.log('\n> [!WARNING]');
  console.log('> **Compliance Rule Parity warning**:');
  console.log(`> Changes detected in Python optimizer-service (\`${OPTIMIZER_DIR}\`) but NOT in TypeScript compliance auditor (\`${COMPLIANCE_DIR}\`).`);
  console.log('> Remember that the CP-SAT solver and V8 compliance auditor must agree on every rule.');
}

if (impactedFiles.size === 0) {
  console.log('\nNo downstream file impacts detected in graph.json.');
} else {
  console.log(`\nDetected **${impactedFiles.size}** downstream file(s) that depend on your changes:\n`);
  
  // Sort by depth
  const sortedFiles = Array.from(impactedFiles.entries()).sort((a, b) => {
    const minDepthA = Math.min(...a[1].map(x => x.depth));
    const minDepthB = Math.min(...b[1].map(x => x.depth));
    return minDepthA - minDepthB;
  });

  console.log('| Impacted File | Min Depth | Dependency Path |');
  console.log('| --- | --- | --- |');
  for (const [file, impacts] of sortedFiles) {
    const minDepth = Math.min(...impacts.map(x => x.depth));
    // Build unique paths representation
    const paths = impacts.map(imp => {
      return `\`${imp.path.join(' -> ')}\` (${imp.relation})`;
    }).slice(0, 3).join('<br>'); // limit to top 3 paths for readability
    
    const extraPaths = impacts.length > 3 ? `<br>*...and ${impacts.length - 3} more*` : '';
    console.log(`| [${path.basename(file)}](file://${path.resolve(file)}) | ${minDepth} | ${paths}${extraPaths} |`);
  }
}
