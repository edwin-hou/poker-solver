/**
 * Minimal persistent tree used by Beat Fish. Nodes are never discarded when
 * the learner returns to a decision and chooses another hero action.
 */

export function createTrainerTree() {
  return {
    nextId: 1,
    rootId: null,
    nodes: new Map(),
  };
}

export function addTrainerTreeNode(tree, moment, { parentId = null, choiceId = null } = {}) {
  if (parentId !== null && !tree.nodes.has(parentId)) {
    throw new Error(`Unknown parent trainer node: ${parentId}`);
  }
  if (parentId !== null && !choiceId) {
    throw new Error("A branch choice is required for a non-root trainer node.");
  }

  const parent = parentId === null ? null : tree.nodes.get(parentId);
  const existingId = parent?.children?.[choiceId];
  if (existingId) return tree.nodes.get(existingId);

  const id = `moment-${tree.nextId}`;
  tree.nextId += 1;
  const node = {
    ...moment,
    id,
    parentId,
    parentChoice: choiceId,
    children: {},
  };
  tree.nodes.set(id, node);

  if (parent) parent.children[choiceId] = id;
  else if (tree.rootId === null) tree.rootId = id;
  else throw new Error("Trainer tree already has a root node.");

  return node;
}

export function trainerTreePath(tree, nodeId) {
  const path = [];
  let node = tree.nodes.get(nodeId);
  if (!node) throw new Error(`Unknown trainer node: ${nodeId}`);
  while (node) {
    path.push(node);
    node = node.parentId === null ? null : tree.nodes.get(node.parentId);
  }
  return path.reverse();
}

export function trainerTreeChild(tree, parentId, choiceId) {
  const parent = tree.nodes.get(parentId);
  if (!parent) throw new Error(`Unknown trainer node: ${parentId}`);
  const childId = parent.children[choiceId];
  return childId ? tree.nodes.get(childId) : null;
}
