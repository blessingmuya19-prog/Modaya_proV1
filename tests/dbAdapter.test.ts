/**
 * Tests for database drivers and factory resolution.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  MemoryDbDriver,
  FsDbDriver,
  resolveDbDriver,
} from '@/lib/server/dbAdapter';
import type { User, Project } from '@/lib/db';

const mockUser: User = {
  id: 'u-1',
  email: 'test@example.com',
  name: 'Tester',
  passwordHash: 'hash123',
  createdAt: '2026-09-03T10:00:00.000Z',
  plan: 'pro',
  storageUsedMb: 120,
};

const mockProject: Project = {
  id: 'p-1',
  userId: 'u-1',
  title: 'My Edit',
  filename: 'input.mp4',
  status: 'ready',
  durationS: 60,
  aspectRatio: '16:9',
  prompt: 'Fast cut',
  clips: [],
  aiHistory: [],
  createdAt: '2026-09-03T10:00:00.000Z',
  updatedAt: '2026-09-03T10:05:00.000Z',
  exportedAt: null,
  sizeMb: 45,
  thumbnail: '',
};

describe('MemoryDbDriver', () => {
  it('saves and returns users and projects in memory', async () => {
    const driver = new MemoryDbDriver();
    expect(driver.driver).toBe('mem');
    expect(driver.isDurable).toBe(false);

    await driver.saveUsers([mockUser]);
    const users = await driver.getUsers();
    expect(users).toHaveLength(1);
    expect(users[0].email).toBe('test@example.com');

    await driver.saveProjects([mockProject]);
    const projects = await driver.getProjects();
    expect(projects).toHaveLength(1);
    expect(projects[0].title).toBe('My Edit');
  });
});

describe('resolveDbDriver', () => {
  const origEnv = process.env;

  beforeEach(() => {
    process.env = { ...origEnv };
  });

  afterEach(() => {
    process.env = origEnv;
  });

  it('selects Postgres driver when DATABASE_URL is set', () => {
    process.env.DATABASE_URL = 'postgres://user:pass@ep-cool-123.us-east-2.aws.neon.tech/neondb';
    const d = resolveDbDriver();
    expect(d.driver).toBe('postgres');
    expect(d.isDurable).toBe(true);
  });

  it('selects FS driver when DATA_DIR is set', () => {
    delete process.env.DATABASE_URL;
    delete process.env.POSTGRES_URL;
    process.env.DATA_DIR = './custom-data';
    const d = resolveDbDriver();
    expect(d.driver).toBe('fs');
    expect(d.isDurable).toBe(true);
  });
});
