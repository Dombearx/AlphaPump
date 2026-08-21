/**
 * Tagi w panelu — przegląd, zmiana nazwy, scalanie, usuwanie i przywracanie.
 *
 * Tag jest bytem globalnym bez autora, więc jedyne, co o nim wiadomo, to **kto
 * go używa**. Dlatego kolumna użycia rozbija ćwiczenia na główne i dodatkowe:
 * tag dodatkowy da się zdjąć edycją ćwiczenia, a główny trzeba zastąpić innym,
 * bo ćwiczenie bez tagu głównego nie istnieje. Ta różnica decyduje o tym, ile
 * pracy stoi za usunięciem tagu — i dlatego jest widoczna, zanim ktoś kliknie.
 *
 * Scalanie działa tak samo jak przy ćwiczeniach i w tę samą stronę: ten wiersz
 * znika, wybrany zostaje. Ćwiczeniu, które miało oba tagi, zostaje jeden —
 * zestaw tagów jest zbiorem, a nie listą, więc nic tu nie ginie.
 */

import type { LibraryTag } from '@alphapump/core';
import { useState } from 'react';
import { Badge, Button, Cell, Empty, Input, Row, Select, Table } from './ui';
import { tagDeletionProblem, tagMergeTargets } from '../lib/library-view';

export interface TagLibraryProps {
  rows: readonly LibraryTag[];
  busy: boolean;
  onRename: (entry: LibraryTag, name: string) => void;
  onDelete: (entry: LibraryTag) => void;
  onRestore: (entry: LibraryTag) => void;
  onMerge: (source: LibraryTag, targetId: string) => void;
}

export function TagLibrary({
  rows,
  busy,
  onRename,
  onDelete,
  onRestore,
  onMerge,
}: TagLibraryProps) {
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);
  /** Tag, przy którym otwarto wybór celu scalenia; `null` — żaden. */
  const [merging, setMerging] = useState<{ id: string; targetId: string } | null>(null);

  if (rows.length === 0) return <Empty>No tags yet.</Empty>;

  return (
    <Table head={['Name', 'Color', 'Usage', '']}>
      {rows.map((entry) => {
        const { tag } = entry;
        const deleted = tag.deletedAt !== null;
        const problem = tagDeletionProblem(entry);

        return (
          <Row key={tag.id}>
            <Cell>
              {editing?.id === tag.id ? (
                <div className="flex items-center gap-2">
                  <Input
                    value={editing.name}
                    autoFocus
                    maxLength={80}
                    onChange={(event) => {
                      setEditing({ id: tag.id, name: event.target.value });
                    }}
                  />
                  <Button
                    size="sm"
                    disabled={busy || editing.name.trim().length === 0}
                    onClick={() => {
                      onRename(entry, editing.name.trim());
                      setEditing(null);
                    }}
                  >
                    Save
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setEditing(null);
                    }}
                  >
                    Cancel
                  </Button>
                </div>
              ) : (
                <>
                  <span className={deleted ? 'font-medium text-muted line-through' : 'font-medium'}>
                    {tag.name}
                  </span>
                  {entry.builtIn && (
                    <Badge tone="accent" className="ml-2">
                      wbudowany
                    </Badge>
                  )}
                  {deleted && (
                    <Badge tone="danger" className="ml-2">
                      deleted
                    </Badge>
                  )}
                </>
              )}
            </Cell>

            <Cell>
              <span className="flex items-center gap-2 text-xs text-muted">
                <span
                  className="inline-block size-4 rounded-full border border-border"
                  style={{ backgroundColor: tag.color }}
                />
                {tag.color}
              </span>
            </Cell>

            <Cell className="text-xs text-muted">
              {entry.usage.exercises === 0 ? (
                '—'
              ) : (
                <>
                  <span className="block">
                    {entry.usage.primaryExercises} primary · {entry.usage.additionalExercises} jako
                    dodatkowy
                  </span>
                  {entry.usage.sets > 0 && (
                    <span className="block">{entry.usage.sets} sets on those exercises</span>
                  )}
                </>
              )}
              {entry.usage.goals > 0 && (
                <span className="block">{entry.usage.goals} cycle goals</span>
              )}
            </Cell>

            <Cell>
              <div className="flex flex-wrap justify-end gap-2">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setEditing({ id: tag.id, name: tag.name });
                  }}
                >
                  Rename
                </Button>

                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setMerging(merging?.id === tag.id ? null : { id: tag.id, targetId: '' });
                  }}
                >
                  {merging?.id === tag.id ? 'Collapse' : 'Merge'}
                </Button>

                {deleted ? (
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={busy}
                    onClick={() => {
                      onRestore(entry);
                    }}
                  >
                    Restore
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    variant="danger"
                    disabled={busy || problem !== null}
                    title={problem ?? ''}
                    onClick={() => {
                      onDelete(entry);
                    }}
                  >
                    Delete
                  </Button>
                )}
              </div>

              {problem !== null && !deleted && (
                <p className="mt-1 text-right text-xs text-muted">{problem}</p>
              )}

              {merging?.id === tag.id && (
                <div className="mt-2 flex flex-wrap items-center justify-end gap-2">
                  <Select
                    className="max-w-xs"
                    value={merging.targetId}
                    onChange={(event) => {
                      setMerging({ id: tag.id, targetId: event.target.value });
                    }}
                  >
                    <option value="">— wybierz tag docelowy —</option>
                    {tagMergeTargets(rows, entry).map((target) => (
                      <option key={target.tag.id} value={target.tag.id}>
                        {target.tag.name} ({target.usage.exercises} exercises)
                      </option>
                    ))}
                  </Select>
                  <Button
                    size="sm"
                    disabled={busy || merging.targetId.length === 0}
                    onClick={() => {
                      onMerge(entry, merging.targetId);
                      setMerging(null);
                    }}
                  >
                    Merge and remove „{tag.name}"
                  </Button>
                </div>
              )}
            </Cell>
          </Row>
        );
      })}
    </Table>
  );
}
