// tree.ts — the Studium activity-bar sidebar. A thin vscode.TreeDataProvider over the pure buildLessonTree
// shaping (lesson-tree.ts): it maps TreeNode → vscode.TreeItem and refreshes when the live reproduction
// state changes. Community discovery is injected so this file stays free of config/fs plumbing.
import * as vscode from "vscode";
import { buildLessonTree, type CommunityItem, type TreeNode } from "./lesson-tree.js";

export class StudiumTreeProvider implements vscode.TreeDataProvider<TreeNode> {
  private readonly _changed = new vscode.EventEmitter<TreeNode | undefined>();
  readonly onDidChangeTreeData = this._changed.event;
  private reproScene = false;

  /** `discover` returns the currently-approved community bundles (injected so this stays vscode-only). */
  constructor(private readonly discover: () => CommunityItem[]) {}

  /** Toggle the live "a reproduction scene is open" state; repaints the tree only on a change. */
  setReproductionScene(on: boolean): void {
    if (this.reproScene === on) return;
    this.reproScene = on;
    this.refresh();
  }

  refresh(): void { this._changed.fire(undefined); }

  getTreeItem(node: TreeNode): vscode.TreeItem {
    const state = node.children?.length
      ? vscode.TreeItemCollapsibleState.Expanded
      : vscode.TreeItemCollapsibleState.None;
    const item = new vscode.TreeItem(node.label, state);
    if (node.icon) item.iconPath = new vscode.ThemeIcon(node.icon);
    if (node.tooltip) item.tooltip = node.tooltip;
    if (node.command) item.command = { command: node.command, title: node.label, arguments: node.args ?? [] };
    return item;
  }

  getChildren(node?: TreeNode): TreeNode[] {
    if (node) return node.children ?? [];
    return buildLessonTree({ community: this.safeDiscover(), onReproductionScene: this.reproScene });
  }

  /** Discovery must never break the tree — a scan error yields an empty community list. */
  private safeDiscover(): CommunityItem[] {
    try { return this.discover(); } catch { return []; }
  }
}
