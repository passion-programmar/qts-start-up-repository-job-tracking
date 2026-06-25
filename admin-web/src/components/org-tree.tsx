'use client';

import type { ReactNode } from 'react';
import { CandidateName } from '@/components/CandidateName';
import type { Bidder, Candidate, UserAccount } from '@/lib/types';

export const GROUP_MANAGERS = 'group-managers';
export const GROUP_CALLERS = 'group-callers';

export type BidderNode = {
  bidder: Bidder;
  candidates: Candidate[];
};

export type ManagerNode = {
  manager: UserAccount;
  bidders: BidderNode[];
};

export function isTreeEntityActive(active: boolean | undefined | null): boolean {
  return active !== false;
}

export function isManagerAccount(user: UserAccount): boolean {
  return user.role === 'manager';
}

export function isCallerAccount(user: UserAccount): boolean {
  return user.role === 'caller';
}

export function buildBidderTree(bidders: Bidder[], candidates: Candidate[]): BidderNode[] {
  const candidatesByBidder = new Map<number, Candidate[]>();
  for (const candidate of candidates) {
    if (!candidate.bidder_id) continue;
    const list = candidatesByBidder.get(candidate.bidder_id) || [];
    list.push(candidate);
    candidatesByBidder.set(candidate.bidder_id, list);
  }

  return [...bidders]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((bidder) => ({
      bidder,
      candidates: (candidatesByBidder.get(bidder.id) || []).sort((a, b) => a.name.localeCompare(b.name)),
    }));
}

export function buildManagerTree(
  managers: UserAccount[],
  bidders: Bidder[],
  candidates: Candidate[]
): ManagerNode[] {
  const candidatesByBidder = new Map<number, Candidate[]>();
  for (const candidate of candidates) {
    if (!candidate.bidder_id) continue;
    const list = candidatesByBidder.get(candidate.bidder_id) || [];
    list.push(candidate);
    candidatesByBidder.set(candidate.bidder_id, list);
  }

  const biddersByManager = new Map<number, Bidder[]>();
  for (const bidder of bidders) {
    if (!bidder.manager_id) continue;
    const list = biddersByManager.get(bidder.manager_id) || [];
    list.push(bidder);
    biddersByManager.set(bidder.manager_id, list);
  }

  return managers
    .filter(isManagerAccount)
    .sort((a, b) => a.username.localeCompare(b.username))
    .map((manager) => ({
      manager,
      bidders: (biddersByManager.get(manager.id) || [])
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((bidder) => ({
          bidder,
          candidates: (candidatesByBidder.get(bidder.id) || []).sort((a, b) =>
            a.name.localeCompare(b.name)
          ),
        })),
    }));
}

function TreeChevron({ open, muted = false }: { open: boolean; muted?: boolean }) {
  return (
    <span className={`org-tree-chevron${muted ? ' org-tree-chevron--muted' : ''}`} aria-hidden="true">
      {open ? '▼' : '▶'}
    </span>
  );
}

function InactiveBadge() {
  return <span className="badge badge-inactive">Inactive</span>;
}

function TreeRowToggle({
  active,
  isOpen,
  onToggle,
  children,
  className = '',
}: {
  active: boolean;
  isOpen: boolean;
  onToggle: () => void;
  children: ReactNode;
  className?: string;
}) {
  if (!active) {
    return (
      <div className={`org-tree-row org-tree-row--inactive${className ? ` ${className}` : ''}`} aria-disabled="true">
        <TreeChevron open={false} muted />
        {children}
      </div>
    );
  }

  return (
    <button
      type="button"
      className={`org-tree-row${className ? ` ${className}` : ''}`}
      onClick={onToggle}
      aria-expanded={isOpen}
    >
      <TreeChevron open={isOpen} />
      {children}
    </button>
  );
}

export function CandidateLeaf({
  candidate,
  onEdit,
  onDelete,
}: {
  candidate: Candidate;
  onEdit?: () => void;
  onDelete?: () => void;
}) {
  const active = isTreeEntityActive(candidate.is_active);
  const hasActions = Boolean(onEdit || onDelete);

  return (
    <div
      className={`org-tree-leaf org-tree-leaf--candidate${active ? '' : ' is-inactive'}${hasActions ? ' org-tree-leaf--has-actions' : ''}`}
    >
      <span className="org-tree-type">Candidate</span>
      <span className="org-tree-name">
        <CandidateName candidate={candidate} index={candidate.id} showNewBadge={false} />
      </span>
      {active ? (
        <span className="badge badge-active">Active</span>
      ) : (
        <InactiveBadge />
      )}
      {candidate.stack ? <span className="text-muted org-tree-meta">{candidate.stack}</span> : null}
      {hasActions && (
        <div className="org-tree-leaf-actions">
          {onEdit && (
            <button className="btn btn-ghost btn-sm" type="button" onClick={onEdit}>
              Edit
            </button>
          )}
          {onDelete && (
            <button className="btn btn-danger btn-sm" type="button" onClick={onDelete}>
              Delete
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export function BidderBranch({
  node,
  expanded,
  onToggle,
  onEdit,
  onManage,
  onDelete,
  onAddCandidate,
  onEditCandidate,
  onDeleteCandidate,
}: {
  node: BidderNode;
  expanded: Record<string, boolean>;
  onToggle: (key: string) => void;
  onEdit?: () => void;
  onManage?: () => void;
  onDelete?: () => void;
  onAddCandidate?: () => void;
  onEditCandidate?: (candidate: Candidate) => void;
  onDeleteCandidate?: (candidate: Candidate) => void;
}) {
  const key = `b-${node.bidder.id}`;
  const active = isTreeEntityActive(node.bidder.is_active);
  const isOpen = active && Boolean(expanded[key]);
  const hasActions = Boolean(onEdit || onManage || onDelete || onAddCandidate);

  return (
    <div className={`org-tree-branch org-tree-branch--bidder${active ? '' : ' is-inactive'}`}>
      <div className={hasActions ? 'org-tree-branch-header' : undefined}>
        <TreeRowToggle
          active={active}
          isOpen={isOpen}
          onToggle={() => onToggle(key)}
        >
          <span className="org-tree-type">Bidder</span>
          <span className="org-tree-name">{node.bidder.name}</span>
          {!active && <InactiveBadge />}
          <span className="text-muted org-tree-meta">
            {node.candidates.length} candidate{node.candidates.length === 1 ? '' : 's'}
          </span>
        </TreeRowToggle>
        {hasActions && (
          <div className="org-tree-branch-actions">
            {onAddCandidate && active && (
              <button className="btn btn-ghost btn-sm" type="button" onClick={onAddCandidate}>+ Candidate</button>
            )}
            {onEdit && (
              <button className="btn btn-ghost btn-sm" type="button" onClick={onEdit}>Edit</button>
            )}
            {onManage && (
              <button className="btn btn-ghost btn-sm" type="button" onClick={onManage}>Credentials</button>
            )}
            {onDelete && (
              <button className="btn btn-danger btn-sm" type="button" onClick={onDelete}>Delete</button>
            )}
          </div>
        )}
      </div>
      {isOpen && (
        <div className="org-tree-children org-tree-children--candidates">
          {node.candidates.length ? (
            node.candidates.map((candidate) => (
              <CandidateLeaf
                key={candidate.id}
                candidate={candidate}
                onEdit={onEditCandidate ? () => onEditCandidate(candidate) : undefined}
                onDelete={onDeleteCandidate ? () => onDeleteCandidate(candidate) : undefined}
              />
            ))
          ) : (
            <p className="org-tree-empty">No candidates yet.</p>
          )}
        </div>
      )}
    </div>
  );
}

export function ManagerBranch({
  node,
  expanded,
  onToggle,
  onEdit,
  onDelete,
  hideManagerActions = false,
  renderBidder,
}: {
  node: ManagerNode;
  expanded: Record<string, boolean>;
  onToggle: (key: string) => void;
  onEdit?: () => void;
  onDelete?: () => void;
  hideManagerActions?: boolean;
  renderBidder?: (bidderNode: BidderNode) => ReactNode;
}) {
  const key = `m-${node.manager.id}`;
  const active = isTreeEntityActive(node.manager.is_active);
  const isOpen = active && Boolean(expanded[key]);
  const candidateTotal = node.bidders.reduce((sum, b) => sum + b.candidates.length, 0);

  return (
    <div className={`org-tree-branch org-tree-branch--manager${active ? '' : ' is-inactive'}`}>
      <div className="org-tree-branch-header">
        <TreeRowToggle
          active={active}
          isOpen={isOpen}
          onToggle={() => onToggle(key)}
          className="org-tree-row--manager"
        >
          <span className="org-tree-type">Manager</span>
          <span className="org-tree-name">{node.manager.username}</span>
          {!active && <InactiveBadge />}
          <span className="text-muted org-tree-meta">
            {node.bidders.length} bidder{node.bidders.length === 1 ? '' : 's'} · {candidateTotal} candidate{candidateTotal === 1 ? '' : 's'}
          </span>
        </TreeRowToggle>
        {!hideManagerActions && (onEdit || onDelete) && (
          <div className="org-tree-branch-actions">
            {onEdit && <button className="btn btn-ghost btn-sm" type="button" onClick={onEdit}>Edit</button>}
            {onDelete && <button className="btn btn-danger btn-sm" type="button" onClick={onDelete}>Delete</button>}
          </div>
        )}
      </div>
      {isOpen && (
        <div className="org-tree-children org-tree-children--bidders">
          {node.bidders.length ? (
            node.bidders.map((bidderNode) =>
              renderBidder ? (
                <div key={bidderNode.bidder.id}>{renderBidder(bidderNode)}</div>
              ) : (
                <BidderBranch
                  key={bidderNode.bidder.id}
                  node={bidderNode}
                  expanded={expanded}
                  onToggle={onToggle}
                />
              )
            )
          ) : (
            <p className="org-tree-empty">No bidders yet.</p>
          )}
        </div>
      )}
    </div>
  );
}

export function CallerBranch({
  caller,
  expanded,
  onToggle,
}: {
  caller: UserAccount;
  expanded: Record<string, boolean>;
  onToggle: (key: string) => void;
}) {
  const key = `c-${caller.id}`;
  const isOpen = Boolean(expanded[key]);

  return (
    <div className="org-tree-branch org-tree-branch--caller">
      <button type="button" className="org-tree-row" onClick={() => onToggle(key)} aria-expanded={isOpen}>
        <TreeChevron open={isOpen} />
        <span className="org-tree-type">Caller</span>
        <span className="org-tree-name">{caller.username}</span>
        {caller.bidder_name ? (
          <span className="text-muted org-tree-meta">{caller.bidder_name}</span>
        ) : null}
      </button>
      {isOpen && (
        <div className="org-tree-children">
          <p className="org-tree-empty">Caller account — assign interviews from Interviews.</p>
        </div>
      )}
    </div>
  );
}

export function RoleGroupCard({
  groupKey,
  title,
  summary,
  expanded,
  onToggle,
  children,
}: {
  groupKey: string;
  title: string;
  summary: string;
  expanded: Record<string, boolean>;
  onToggle: (key: string) => void;
  children: ReactNode;
}) {
  const isOpen = Boolean(expanded[groupKey]);

  return (
    <div className={`org-tree-group org-tree-group--role${isOpen ? ' is-open' : ''}`}>
      <button
        type="button"
        className="org-tree-row org-tree-row--role"
        onClick={() => onToggle(groupKey)}
        aria-expanded={isOpen}
      >
        <TreeChevron open={isOpen} />
        <span className="org-tree-role-title">{title}</span>
        <span className="text-muted org-tree-meta">{summary}</span>
      </button>
      {isOpen && <div className="org-tree-group-body">{children}</div>}
    </div>
  );
}
