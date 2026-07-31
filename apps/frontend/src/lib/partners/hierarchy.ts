/**
 * Agent hierarchy (Phase 6C, STEP 3).
 *
 * A Master-Agent → Sub-Agent → Dealer tree with validated links, configurable depth
 * limits and **cycle detection**. Pure structure over partner ids — it owns no money;
 * commission roll-ups read this tree but never post to a ledger.
 */
import { type PartnerTreeNode, type PartnerType } from './types';

export class HierarchyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HierarchyError';
  }
}

export interface HierarchyNode {
  partnerId: string;
  type: PartnerType;
  parentId?: string;
}

export class AgentHierarchy {
  private readonly nodes = new Map<string, HierarchyNode>();
  private readonly children = new Map<string, Set<string>>();

  constructor(private readonly maxDepth = 5) {}

  addPartner(partnerId: string, type: PartnerType): void {
    if (!this.nodes.has(partnerId)) this.nodes.set(partnerId, { partnerId, type });
  }

  /** Link child → parent with cycle + depth validation. */
  link(childId: string, parentId: string): void {
    if (childId === parentId) throw new HierarchyError('a partner cannot be its own parent');
    const child = this.nodes.get(childId);
    const parent = this.nodes.get(parentId);
    if (!child || !parent) throw new HierarchyError('both partners must exist before linking');
    if (child.parentId) throw new HierarchyError('partner already has a parent');
    // Cycle detection: parent must not be a descendant of child.
    if (this.isDescendant(parentId, childId)) throw new HierarchyError('cycle detected');
    // Depth limit: maxDepth caps the number of levels (root = level 0), so the
    // deepest resulting node's depth must stay below maxDepth.
    const parentDepth = this.depthOf(parentId);
    if (parentDepth + 1 + this.subtreeHeight(childId) >= this.maxDepth) throw new HierarchyError(`depth limit ${this.maxDepth} exceeded`);
    child.parentId = parentId;
    this.children.set(parentId, (this.children.get(parentId) ?? new Set()).add(childId));
  }

  private isDescendant(candidateId: string, ancestorId: string): boolean {
    // Is candidate within the subtree rooted at ancestor?
    const stack = [...(this.children.get(ancestorId) ?? [])];
    while (stack.length) {
      const cur = stack.pop()!;
      if (cur === candidateId) return true;
      stack.push(...(this.children.get(cur) ?? []));
    }
    return false;
  }
  private depthOf(partnerId: string): number {
    let depth = 0;
    let cur = this.nodes.get(partnerId);
    const seen = new Set<string>();
    while (cur?.parentId) {
      if (seen.has(cur.partnerId)) break; // defensive
      seen.add(cur.partnerId);
      depth += 1;
      cur = this.nodes.get(cur.parentId);
    }
    return depth;
  }
  private subtreeHeight(partnerId: string): number {
    const kids = this.children.get(partnerId);
    if (!kids || kids.size === 0) return 0;
    return 1 + Math.max(...[...kids].map((k) => this.subtreeHeight(k)));
  }

  parentOf(partnerId: string): string | undefined {
    return this.nodes.get(partnerId)?.parentId;
  }
  childrenOf(partnerId: string): string[] {
    return [...(this.children.get(partnerId) ?? [])];
  }

  /** All ancestor ids from parent up to the root (for commission roll-up). */
  ancestors(partnerId: string): string[] {
    const out: string[] = [];
    let cur = this.nodes.get(partnerId)?.parentId;
    const seen = new Set<string>();
    while (cur && !seen.has(cur)) {
      seen.add(cur);
      out.push(cur);
      cur = this.nodes.get(cur)?.parentId;
    }
    return out;
  }

  /** All descendant ids (the partner's downline). */
  descendants(partnerId: string): string[] {
    const out: string[] = [];
    const stack = [...(this.children.get(partnerId) ?? [])];
    while (stack.length) {
      const cur = stack.pop()!;
      out.push(cur);
      stack.push(...(this.children.get(cur) ?? []));
    }
    return out;
  }

  /** Build the tree rooted at a partner. */
  tree(partnerId: string): PartnerTreeNode {
    const node = this.nodes.get(partnerId);
    if (!node) throw new HierarchyError('no such partner');
    return { partnerId, type: node.type, children: this.childrenOf(partnerId).map((c) => this.tree(c)) };
  }
}
