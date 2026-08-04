#!/usr/bin/env node
/**
 * Apply queued issue triage: type + priority labels and RICE comment.
 * Skips open issues that already have both a type and priority label.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const OWNER = 'anne-markis';
const REPO = 'software-factory-the-game';

const TYPE_LABELS = new Set([
  'bug',
  'enhancement',
  'duplicate',
  'documentation',
  'question',
  'invalid',
  'wontfix',
]);
const PRIORITY_LABELS = new Set(['high', 'medium', 'low']);

const token = process.env.GITHUB_TOKEN;
if (!token) {
  console.error('GITHUB_TOKEN is required');
  process.exit(1);
}

const api = async (path, options = {}) => {
  const res = await fetch(`https://api.github.com${path}`, {
    ...options,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers,
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${options.method ?? 'GET'} ${path} failed (${res.status}): ${text}`);
  }
  return res.status === 204 ? null : res.json();
};

const hasTypeLabel = (labels) => labels.some((l) => TYPE_LABELS.has(l.name));
const hasPriorityLabel = (labels) => labels.some((l) => PRIORITY_LABELS.has(l.name));
const hasRiceComment = (comments) =>
  comments.some((c) => c.body?.includes('## RICE triage'));

const __dirname = dirname(fileURLToPath(import.meta.url));
const queuePath = join(__dirname, 'triage-queue.json');
const queue = JSON.parse(readFileSync(queuePath, 'utf8'));

let applied = 0;
let skipped = 0;

for (const entry of queue) {
  const issue = await api(`/repos/${OWNER}/${REPO}/issues/${entry.number}`);
  if (issue.state !== 'open') {
    console.log(`#${entry.number}: skipped (not open)`);
    skipped++;
    continue;
  }

  const labels = issue.labels ?? [];
  const comments = await api(`/repos/${OWNER}/${REPO}/issues/${entry.number}/comments`);

  if (hasTypeLabel(labels) && hasPriorityLabel(labels)) {
    console.log(`#${entry.number}: skipped (already labeled)`);
    skipped++;
    continue;
  }

  const labelsToAdd = [];
  if (!hasTypeLabel(labels)) labelsToAdd.push(entry.type);
  if (!hasPriorityLabel(labels)) labelsToAdd.push(entry.priority);

  if (labelsToAdd.length > 0) {
    await api(`/repos/${OWNER}/${REPO}/issues/${entry.number}/labels`, {
      method: 'POST',
      body: JSON.stringify(labelsToAdd),
    });
    console.log(`#${entry.number}: added labels ${labelsToAdd.join(', ')}`);
  }

  if (!hasRiceComment(comments)) {
    await api(`/repos/${OWNER}/${REPO}/issues/${entry.number}/comments`, {
      method: 'POST',
      body: JSON.stringify({ body: entry.comment }),
    });
    console.log(`#${entry.number}: posted RICE comment`);
  } else {
    console.log(`#${entry.number}: RICE comment already present`);
  }

  applied++;
}

console.log(`Done. Applied ${applied}, skipped ${skipped}.`);
