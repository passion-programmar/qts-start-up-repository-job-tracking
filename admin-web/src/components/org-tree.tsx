'use client';

import type { ReactNode } from 'react';
import { CandidateName } from '@/components/CandidateName';
import type { Account, Candidate, UserAccount } from '@/lib/types';

export const GROUP_MANAGERS = 'group-managers';
export const GROUP_CALLERS = 'group-callers';

export type AccountNode = {
  account: Account;
  candidates: Candidate[];
};

export type ManagerNode = {
  manager: UserAccount;
  accounts: AccountNode[];
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

export function buildAccountTree(accounts: Account[], candidates: Candidate[]): AccountNode[] {
  const candidatesByAccount = new Map<number, Candidate[]>();
  for (const candidate of candidates) {
    if (!candidate.account_id) continue;
    const list = candidatesByAccount.get(candidate.account_id) || [];
    list.push(candidate);
    candidatesByAccount.set(candidate.account_id, list);
  }

  return [...accounts]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((account) => ({
      account,
      candidates: (candidatesByAccount.get(account.id) || []).sort((a, b) => a.name.localeCompare(b.name)),
    }));
}

export function buildManagerTree(
  managers: UserAccount[],
  accounts: Account[],
  candidates: Candidate[]
): ManagerNode[] {
  const candidatesByAccount = new Map<number, Candidate[]>();
  for (const candidate of candidates) {
    if (!candidate.account_id) continue;
    const list = candidatesByAccount.get(candidate.account_id) || [];
    list.push(candidate);
    candidatesByAccount.set(candidate.account_id, list);
  }

  const accountsByManager = new Map<number, Account[]>();
  for (const account of accounts) {
    if (!account.manager_id) continue;
    const list = accountsByManager.get(account.manager_id) || [];
    list.push(account);
    accountsByManager.set(account.manager_id, list);
  }

  return managers
    .filter(isManagerAccount)
    .sort((a, b) => a.username.localeCompare(b.username))
    .map((manager) => ({
      manager,
      accounts: (accountsByManager.get(manager.id) || [])
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((account) => ({
          account,
          candidates: (candidatesByAccount.get(account.id) || []).sort((a, b) =>
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

export function AccountBranch({
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
  node: AccountNode;
  expanded: Record<string, boolean>;
  onToggle: (key: string) => void;
  onEdit?: () => void;
  onManage?: () => void;
  onDelete?: () => void;
  onAddCandidate?: () => void;
  onEditCandidate?: (candidate: Candidate) => void;
  onDeleteCandidate?: (candidate: Candidate) => void;
}) {
  const key = `b-${node.account.id}`;
  const active = isTreeEntityActive(node.account.is_active);
  const isOpen = active && Boolean(expanded[key]);
  const hasActions = Boolean(onEdit || onManage || onDelete || onAddCandidate);

  return (
    <div className={`org-tree-branch org-tree-branch--account${active ? '' : ' is-inactive'}`}>
      <div className={hasActions ? 'org-tree-branch-header' : undefined}>
        <TreeRowToggle
          active={active}
          isOpen={isOpen}
          onToggle={() => onToggle(key)}
        >
          <span className="org-tree-type">Account</span>
          <span className="org-tree-name">{node.account.name}</span>
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
  renderAccount,
}: {
  node: ManagerNode;
  expanded: Record<string, boolean>;
  onToggle: (key: string) => void;
  onEdit?: () => void;
  onDelete?: () => void;
  hideManagerActions?: boolean;
  renderAccount?: (accountNode: AccountNode) => ReactNode;
}) {
  const key = `m-${node.manager.id}`;
  const active = isTreeEntityActive(node.manager.is_active);
  const isOpen = active && Boolean(expanded[key]);
  const candidateTotal = node.accounts.reduce((sum, b) => sum + b.candidates.length, 0);

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
            {node.accounts.length} Account{node.accounts.length === 1 ? '' : 's'} · {candidateTotal} candidate{candidateTotal === 1 ? '' : 's'}
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
        <div className="org-tree-children org-tree-children--accounts">
          {node.accounts.length ? (
            node.accounts.map((accountNode) =>
              renderAccount ? (
                <div key={accountNode.account.id}>{renderAccount(accountNode)}</div>
              ) : (
                <AccountBranch
                  key={accountNode.account.id}
                  node={accountNode}
                  expanded={expanded}
                  onToggle={onToggle}
                />
              )
            )
          ) : (
            <p className="org-tree-empty">No Accounts yet.</p>
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
  onEdit,
  onDelete,
}: {
  caller: UserAccount;
  expanded: Record<string, boolean>;
  onToggle: (key: string) => void;
  onEdit?: () => void;
  onDelete?: () => void;
}) {
  const key = `c-${caller.id}`;
  const active = isTreeEntityActive(caller.is_active);
  const isOpen = active && Boolean(expanded[key]);
  const hasActions = Boolean(onEdit || onDelete);

  return (
    <div className={`org-tree-branch org-tree-branch--caller${active ? '' : ' is-inactive'}`}>
      <div className={hasActions ? 'org-tree-branch-header' : undefined}>
        <TreeRowToggle
          active={active}
          isOpen={isOpen}
          onToggle={() => onToggle(key)}
        >
          <span className="org-tree-type">Caller</span>
          <span className="org-tree-name">{caller.username}</span>
          {!active && <InactiveBadge />}
          {caller.account_name ? (
            <span className="text-muted org-tree-meta">{caller.account_name}</span>
          ) : (
            <span className="text-muted org-tree-meta">No account linked</span>
          )}
        </TreeRowToggle>
        {hasActions && (
          <div className="org-tree-branch-actions">
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
