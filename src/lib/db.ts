/**
 * In-process data store with optional filesystem persistence.
 *
 * - Production / Vercel: memory-only (fs never imported — no bundle tracing).
 * - Development (NODE_ENV === 'development'): reads/writes data/*.json so
 *   data survives hot-reloads and server restarts.
 *
 * The NODE_ENV guard is statically analysable by Turbopack/webpack, so the
 * fs/path imports are tree-shaken out of the production bundle entirely —
 * no more "dynamic filesystem access" build warning.
 */

// ── Types ────────────────────────────────────────────────────────────────────

import type { Transcript } from '@/lib/ai/transcript';

export interface User {
  id:           string;
  email:        string;
  name:         string;
  passwordHash: string;
  createdAt:    string;
  plan:         'starter' | 'pro' | 'team';
  storageUsedMb: number;
}

export type ProjectStatus = 'uploading' | 'processing' | 'ready' | 'draft' | 'failed';

export interface Clip {
  id:       string;
  trackId:  string;
  label:    string;
  startS:   number;
  endS:     number;
  type:     'video' | 'audio' | 'text' | 'subtitle';
}

export interface AIMessage {
  role: 'user' | 'ai';
  text: string;
  ts:   string;
}

export interface Project {
  id:          string;
  userId:      string;
  title:       string;
  filename:    string;
  status:      ProjectStatus;
  durationS:   number;
  aspectRatio: string;
  prompt:      string;
  clips:       Clip[];
  aiHistory:   AIMessage[];
  createdAt:   string;
  updatedAt:   string;
  exportedAt:  string | null;
  sizeMb:      number;
  /** Which Studio door the project was created from: 'edit' | 'reference'. */
  mode?:       'edit' | 'reference';
  /** Poster frame captured at upload, stored as a small JPEG data URL */
  thumbnail:   string;
  /** Durable media held in the server object store (ext per role), so a
      reopened project knows which objects exist and can stream them back. */
  media?: {
    main?: { ext: string };
    refs?: { ext: string }[];
    brolls?: { ext: string }[];
  };
  /** Speech recognition output, once it has run. */
  transcript?: Transcript;
  /** The timeline as it stood before the last AI edit, so one step can be
      undone and so a deletion the editor got wrong can be put back. */
  previousClips?: Clip[];
}

// ── Filesystem helpers — dev-only ─────────────────────────────────────────────

const IS_DEV = process.env.NODE_ENV === 'development';

function readJson<T>(file: string, fallback: T): T {
  if (!IS_DEV) return fallback;
  try {
    // These imports are only reached in development; Turbopack tree-shakes
    // them out of the production bundle so no tracing warning is triggered.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs   = require('fs')   as typeof import('fs');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const path = require('path') as typeof import('path');
    const dir  = path.join(process.cwd(), 'data');
    const fp   = path.join(dir, file);
    if (!fs.existsSync(fp)) return fallback;
    return JSON.parse(fs.readFileSync(fp, 'utf-8')) as T;
  } catch { return fallback; }
}

function writeJson(file: string, data: unknown): void {
  if (!IS_DEV) return;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs   = require('fs')   as typeof import('fs');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const path = require('path') as typeof import('path');
    const dir  = path.join(process.cwd(), 'data');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, file), JSON.stringify(data, null, 2));
  } catch { /* ignore write failures */ }
}

// ── In-memory stores (hydrated from disk/driver on first access) ──────────────

import { resolveDbDriver, type DatabaseDriver } from '@/lib/server/dbAdapter';

let _driver:   DatabaseDriver       | null = null;
let _users:    Map<string, User>    | null = null;
let _projects: Map<string, Project> | null = null;

function getDriver(): DatabaseDriver {
  if (!_driver) {
    _driver = resolveDbDriver();
  }
  return _driver;
}

function users(): Map<string, User> {
  if (!_users) {
    const arr = readJson<User[]>('users.json', []);
    _users = new Map(arr.map(u => [u.id, u]));
  }
  return _users;
}

function projects(): Map<string, Project> {
  if (!_projects) {
    const arr = readJson<Project[]>('projects.json', []);
    _projects = new Map(arr.map(p => [p.id, p]));
  }
  return _projects;
}

function saveUsers() {
  const list = Array.from(users().values());
  writeJson('users.json', list);
  void getDriver().saveUsers(list).catch(() => {});
}

function saveProjects() {
  const list = Array.from(projects().values());
  writeJson('projects.json', list);
  void getDriver().saveProjects(list).catch(() => {});
}

export function getDbDriverInfo(): { driver: string; isDurable: boolean } {
  const d = getDriver();
  return { driver: d.driver, isDurable: d.isDurable };
}

// ── Public API ────────────────────────────────────────────────────────────────

export const db = {
  users: {
    findByEmail(email: string): User | undefined {
      return Array.from(users().values()).find(
        u => u.email.toLowerCase() === email.toLowerCase()
      );
    },
    findById(id: string): User | undefined {
      return users().get(id);
    },
    create(user: User): User {
      users().set(user.id, user);
      saveUsers();
      return user;
    },
    update(id: string, patch: Partial<User>): User | null {
      const u = users().get(id);
      if (!u) return null;
      const updated = { ...u, ...patch };
      users().set(id, updated);
      saveUsers();
      return updated;
    },
  },

  projects: {
    findById(id: string): Project | undefined {
      return projects().get(id);
    },
    findByUser(userId: string): Project[] {
      return Array.from(projects().values())
        .filter(p => p.userId === userId)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    },
    create(project: Project): Project {
      projects().set(project.id, project);
      saveProjects();
      return project;
    },
    update(id: string, patch: Partial<Project>): Project | null {
      const p = projects().get(id);
      if (!p) return null;
      const updated = { ...p, ...patch, updatedAt: new Date().toISOString() };
      projects().set(id, updated);
      saveProjects();
      return updated;
    },
    delete(id: string): boolean {
      const existed = projects().has(id);
      projects().delete(id);
      if (existed) saveProjects();
      return existed;
    },
  },
};
