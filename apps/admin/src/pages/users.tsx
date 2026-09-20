/**
 * Zarządzanie kontami.
 *
 * Zakres jest wąski i celowo taki zostaje: nick, rola, blokada i reset hasła.
 * Panel nie kasuje kont i nie ma do tego przycisku — konto jest autorem ćwiczeń
 * i właścicielem serii, więc jego usunięcie albo osierociłoby cudze dane, albo
 * wymagałoby kaskady, która niszczy historię grupy. Blokada odbiera dostęp i to
 * jest właściwa operacja: dane zostają, człowiek nie wchodzi.
 *
 * Reset hasła jest tutaj, bo nie ma go gdzie indziej: poczty w stosie nie ma,
 * więc „przypomnij hasło" nie ma jak dojść do nikogo. Administrator nadaje hasło
 * tymczasowe, przekazuje je osobiście, a właściciel konta ustawia sobie własne
 * przy najbliższym logowaniu. Hasło widać **raz** — patrz
 * `components/temporary-password.tsx`.
 *
 * Trzy blokady bezpieczeństwa egzekwuje serwer (własne konto, konto systemowe,
 * własne hasło), ale panel je **pokazuje** — przycisk, który zawsze kończy się
 * błędem, jest gorszy niż przycisk nieaktywny z wyjaśnieniem.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AdminUser, PasswordResetResult, UpdateUserInput } from '@alphapump/core';
import { useState } from 'react';
import { TemporaryPassword } from '../components/temporary-password';
import { Badge, Button, Cell, Empty, Input, Loading, Problem, Row, Table } from '../components/ui';
import { getMe, listUsers, resetUserPassword, updateUser } from '../lib/api';

/** Konto systemowe jest autorem ćwiczeń wbudowanych — serwer nie da go zmienić. */
const isSystemAccount = (user: AdminUser): boolean => user.email.endsWith('@alphapump.local');

export function UsersPage() {
  const queryClient = useQueryClient();
  const me = useQuery({ queryKey: ['me'], queryFn: () => getMe() });
  const users = useQuery({ queryKey: ['users'], queryFn: () => listUsers() });
  const [editing, setEditing] = useState<{ id: string; nickname: string } | null>(null);
  /**
   * Świeżo nadane hasło tymczasowe. W stanie komponentu, a nie w cache'u
   * zapytań: zamknięcie karty ma je usunąć bez śladu, a `staleTime: 0` i tak
   * kazałby je pobrać ponownie — czego zrobić się nie da i nie powinno.
   */
  const [issued, setIssued] = useState<PasswordResetResult | null>(null);

  const change = useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateUserInput }) => updateUser(id, input),
    onSuccess: () => {
      setEditing(null);
      void queryClient.invalidateQueries({ queryKey: ['users'] });
      void queryClient.invalidateQueries({ queryKey: ['stats'] });
    },
  });

  const resetPassword = useMutation({
    mutationFn: (id: string) => resetUserPassword(id),
    onSuccess: (result) => {
      setIssued(result);
      void queryClient.invalidateQueries({ queryKey: ['users'] });
    },
  });

  if (users.isPending || me.isPending) return <Loading label="Loading accounts…" />;
  if (users.error) return <Problem error={users.error} />;
  if (me.error) return <Problem error={me.error} />;

  const rows = users.data;
  if (rows.length === 0) return <Empty>No accounts yet.</Empty>;

  return (
    <div className="flex flex-col gap-3">
      {change.error !== null && <Problem error={change.error} />}
      {resetPassword.error !== null && <Problem error={resetPassword.error} />}
      {issued !== null && <TemporaryPassword result={issued} onDismiss={() => setIssued(null)} />}

      <Table head={['Account', 'Role', 'State', 'Sets', 'Exercises', '']}>
        {rows.map((user) => {
          const self = user.id === me.data.id;
          const system = isSystemAccount(user);
          const locked = system;

          return (
            <Row key={user.id}>
              <Cell>
                {editing?.id === user.id ? (
                  <div className="flex items-center gap-2">
                    <Input
                      value={editing.nickname}
                      autoFocus
                      onChange={(event) =>
                        setEditing({ id: user.id, nickname: event.target.value })
                      }
                    />
                    <Button
                      size="sm"
                      disabled={change.isPending || editing.nickname.trim().length === 0}
                      onClick={() =>
                        change.mutate({ id: user.id, input: { nickname: editing.nickname.trim() } })
                      }
                    >
                      Save
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>
                      Cancel
                    </Button>
                  </div>
                ) : (
                  <div className="flex flex-col">
                    <span className="font-medium">{user.nickname}</span>
                    <span className="text-xs text-muted">{user.email}</span>
                  </div>
                )}
              </Cell>

              <Cell>
                <Badge tone={user.role === 'admin' ? 'accent' : 'neutral'}>
                  {user.role === 'admin' ? 'administrator' : 'user'}
                </Badge>
              </Cell>

              <Cell>
                <div className="flex flex-col gap-1">
                  {user.banned ? (
                    <>
                      <Badge tone="danger">zablokowane</Badge>
                      {user.banReason !== null && (
                        <span className="text-xs text-muted">{user.banReason}</span>
                      )}
                    </>
                  ) : (
                    <Badge tone="success">aktywne</Badge>
                  )}
                  {/* Odróżnia „zresetowałem i osoba już ustawiła swoje" od
                      „zresetowałem i nadal nikt tego nie odebrał". Bez tego
                      jedyną różnicą byłaby czyjaś pamięć. */}
                  {user.passwordResetAt !== null && <Badge tone="accent">hasło tymczasowe</Badge>}
                </div>
              </Cell>

              <Cell className="tabular-nums">{user.setCount}</Cell>
              <Cell className="tabular-nums">{user.exerciseCount}</Cell>

              <Cell>
                <div className="flex flex-wrap justify-end gap-2">
                  {locked ? (
                    <span className="text-xs text-muted">konto systemowe</span>
                  ) : (
                    <>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setEditing({ id: user.id, nickname: user.nickname })}
                      >
                        Nickname
                      </Button>
                      <Button
                        size="sm"
                        variant="secondary"
                        // Odebranie sobie roli zostawiłoby system bez drogi
                        // powrotu poza ręczną edycją bazy.
                        disabled={change.isPending || (self && user.role === 'admin')}
                        title={self && user.role === 'admin' ? 'Nie odbierzesz roli sobie' : ''}
                        onClick={() =>
                          change.mutate({
                            id: user.id,
                            input: { role: user.role === 'admin' ? 'user' : 'admin' },
                          })
                        }
                      >
                        {user.role === 'admin' ? 'Revoke role' : 'Grant role'}
                      </Button>
                      <Button
                        size="sm"
                        variant="secondary"
                        // Reset kasuje sesje konta, więc na własnym wylogowałby
                        // administratora w chwili, w której panel pokazuje mu
                        // hasło do przepisania. Serwer odmawia, panel nie kusi.
                        disabled={resetPassword.isPending || self}
                        title={self ? 'Własne hasło zmieniasz zwykłą zmianą hasła' : ''}
                        onClick={() => resetPassword.mutate(user.id)}
                      >
                        Reset password
                      </Button>
                      <Button
                        size="sm"
                        variant={user.banned ? 'secondary' : 'danger'}
                        disabled={change.isPending || (self && !user.banned)}
                        title={self && !user.banned ? 'You cannot ban your own account' : ''}
                        onClick={() =>
                          change.mutate({
                            id: user.id,
                            input: user.banned
                              ? { banned: false }
                              : { banned: true, banReason: 'Zablokowane z panelu' },
                          })
                        }
                      >
                        {user.banned ? 'Odblokuj' : 'Zablokuj'}
                      </Button>
                    </>
                  )}
                </div>
              </Cell>
            </Row>
          );
        })}
      </Table>
    </div>
  );
}
