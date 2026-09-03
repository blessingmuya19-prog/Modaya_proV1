/**
 * Server database storage adapters for accounts and projects.
 *
 * Provides swappable persistence drivers:
 *   1. `fs`       — Local filesystem under <DATA_DIR> (default ./data/*.json).
 *   2. `postgres` — Neon / Postgres over HTTP (when DATABASE_URL or POSTGRES_URL is set).
 *   3. `mem`      — In-process memory store for tests and ephemeral serverless environments.
 *
 * Designed with zero external dependencies and zero client bundle overhead.
 */
import type { User, Project } from '../db';

export interface DatabaseDriver {
  readonly driver: 'fs' | 'postgres' | 'mem';
  readonly isDurable: boolean;
  getUsers(): Promise<User[]>;
  saveUsers(users: User[]): Promise<void>;
  getProjects(): Promise<Project[]>;
  saveProjects(projects: Project[]): Promise<void>;
}

// ── In-Memory Driver ──────────────────────────────────────────────────────────

export class MemoryDbDriver implements DatabaseDriver {
  readonly driver = 'mem';
  readonly isDurable = false;
  private users: User[] = [];
  private projects: Project[] = [];

  constructor(initialUsers: User[] = [], initialProjects: Project[] = []) {
    this.users = [...initialUsers];
    this.projects = [...initialProjects];
  }

  async getUsers(): Promise<User[]> {
    return [...this.users];
  }

  async saveUsers(users: User[]): Promise<void> {
    this.users = [...users];
  }

  async getProjects(): Promise<Project[]> {
    return [...this.projects];
  }

  async saveProjects(projects: Project[]): Promise<void> {
    this.projects = [...projects];
  }
}

// ── Filesystem Driver ─────────────────────────────────────────────────────────

export class FsDbDriver implements DatabaseDriver {
  readonly driver = 'fs';
  readonly isDurable = true;
  private root: string;

  constructor(dir?: string) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const path = require('path') as typeof import('path');
    this.root = dir || process.env.DATA_DIR || path.join(process.cwd(), 'data');
  }

  private read<T>(filename: string, fallback: T): T {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const fs = require('fs') as typeof import('fs');
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const path = require('path') as typeof import('path');
      const fp = path.join(this.root, filename);
      if (!fs.existsSync(fp)) return fallback;
      return JSON.parse(fs.readFileSync(fp, 'utf-8')) as T;
    } catch {
      return fallback;
    }
  }

  private write(filename: string, data: unknown): void {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const fs = require('fs') as typeof import('fs');
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const path = require('path') as typeof import('path');
      if (!fs.existsSync(this.root)) fs.mkdirSync(this.root, { recursive: true });
      fs.writeFileSync(path.join(this.root, filename), JSON.stringify(data, null, 2));
    } catch {
      // ignore
    }
  }

  async getUsers(): Promise<User[]> {
    return this.read<User[]>('users.json', []);
  }

  async saveUsers(users: User[]): Promise<void> {
    this.write('users.json', users);
  }

  async getProjects(): Promise<Project[]> {
    return this.read<Project[]>('projects.json', []);
  }

  async saveProjects(projects: Project[]): Promise<void> {
    this.write('projects.json', projects);
  }
}

// ── Neon / Postgres Serverless Driver ─────────────────────────────────────────

export interface PostgresConfig {
  connectionString: string;
}

export class PostgresDbDriver implements DatabaseDriver {
  readonly driver = 'postgres';
  readonly isDurable = true;
  private endpoint: string;
  private token: string;
  private bootstrapped = false;

  constructor(cfg: PostgresConfig) {
    // Parse Neon / Postgres connection URL: postgres://user:password@host/dbname
    const m = /postgres(?:ql)?:\/\/([^:]+):([^@]+)@([^/]+)\/(.+)/.exec(cfg.connectionString);
    if (m) {
      const [, , password, host] = m;
      this.endpoint = `https://${host}/sql`;
      this.token = password;
    } else {
      this.endpoint = cfg.connectionString;
      this.token = '';
    }
  }

  private async query(sql: string, params: unknown[] = []): Promise<unknown[]> {
    if (!this.endpoint.startsWith('http')) {
      return [];
    }
    try {
      const res = await fetch(this.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.token}`,
        },
        body: JSON.stringify({ query: sql, params }),
      });
      if (!res.ok) return [];
      const json = await res.json() as { rows?: unknown[] };
      return json.rows ?? [];
    } catch {
      return [];
    }
  }

  private async ensureSchema() {
    if (this.bootstrapped) return;
    this.bootstrapped = true;
    await this.query(`
      CREATE TABLE IF NOT EXISTS modaya_users (
        id TEXT PRIMARY KEY,
        data JSONB NOT NULL,
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS modaya_projects (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        data JSONB NOT NULL,
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
  }

  async getUsers(): Promise<User[]> {
    await this.ensureSchema();
    const rows = await this.query('SELECT data FROM modaya_users') as Array<{ data: User }>;
    return rows.map(r => r.data).filter(Boolean);
  }

  async saveUsers(users: User[]): Promise<void> {
    await this.ensureSchema();
    for (const u of users) {
      await this.query(
        'INSERT INTO modaya_users (id, data, updated_at) VALUES ($1, $2, NOW()) ON CONFLICT (id) DO UPDATE SET data = $2, updated_at = NOW()',
        [u.id, JSON.stringify(u)],
      );
    }
  }

  async getProjects(): Promise<Project[]> {
    await this.ensureSchema();
    const rows = await this.query('SELECT data FROM modaya_projects') as Array<{ data: Project }>;
    return rows.map(r => r.data).filter(Boolean);
  }

  async saveProjects(projects: Project[]): Promise<void> {
    await this.ensureSchema();
    for (const p of projects) {
      await this.query(
        'INSERT INTO modaya_projects (id, user_id, data, updated_at) VALUES ($1, $2, $3, NOW()) ON CONFLICT (id) DO UPDATE SET user_id = $2, data = $3, updated_at = NOW()',
        [p.id, p.userId, JSON.stringify(p)],
      );
    }
  }
}

// ── Factory ───────────────────────────────────────────────────────────────────

export function resolveDbDriver(): DatabaseDriver {
  const pgUrl = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (pgUrl) {
    return new PostgresDbDriver({ connectionString: pgUrl });
  }

  const isDev = process.env.NODE_ENV === 'development';
  const hasDataDir = !!process.env.DATA_DIR;

  if (isDev || hasDataDir) {
    return new FsDbDriver();
  }

  // Serverless fallback
  return new MemoryDbDriver();
}
