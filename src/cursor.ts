// 一覧の続きを取るための不透明なカーソル（SPEC.md §7「一覧」）

import { isValidSlug } from './slug';

export interface Cursor {
  createdAt: string;
  slug: string;
}

const ISO_8601_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

export function encodeCursor(cursor: Cursor): string {
  const json = JSON.stringify({ createdAt: cursor.createdAt, slug: cursor.slug });
  // 中身は ASCII だけなので btoa でそのまま符号化できる
  return btoa(json).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** 解釈できなければ null */
export function decodeCursor(value: string): Cursor | null {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(atob(value.replace(/-/g, '+').replace(/_/g, '/')));
    if (typeof parsed !== 'object' || parsed === null) return null;
    const { createdAt, slug } = parsed as Record<string, unknown>;
    if (typeof createdAt !== 'string' || !ISO_8601_UTC.test(createdAt)) return null;
    if (typeof slug !== 'string' || !isValidSlug(slug)) return null;
    return { createdAt, slug };
  } catch {
    return null;
  }
}
