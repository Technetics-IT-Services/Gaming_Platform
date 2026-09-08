'use client';

import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Input,
  Spinner,
  cn,
} from '@gaming-platform/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeftRight, Coins, Gift, Sparkles, Star, TrendingUp, Trophy, Wallet as WalletIcon } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import { toast } from 'sonner';

import { RealAccountRequired } from '@/components/auth/real-money-guard';
import { useRealSession } from '@/hooks/use-real-session';
import { EconomyDashboard } from '@/components/economy/economy-dashboard';
import { RarityBadge } from '@/components/economy/rarity-badge';
import { WalletInsight } from '@/components/economy/wallet-insight';
import { AnimatedNumber } from '@/components/marketing/animated-number';
import { PageHeader } from '@/components/shared/page-header';
import { clientConfig } from '@/lib/config';
import { walletInsights } from '@/lib/economy';
import { walletApi, type WalletView } from '@/lib/wallet-api';
import { useAuthStore } from '@/stores/auth-store';

const TYPE_LABEL: Record<string, string> = {
  MAIN: 'Main',
  BONUS: 'Bonus',
  REWARD: 'Reward',
  LOCKED: 'Locked',
  TOURNAMENT: 'Tournament',
  PROMOTIONAL: 'Promotional',
  CASH: 'Cash',
  VIRTUAL: 'Virtual',
};

const CREDIT_TYPES = ['GAME_WIN', 'DEPOSIT', 'TRANSFER_IN', 'BONUS_CREDIT', 'ADMIN_ADJUSTMENT'];

export default function WalletPage() {
  const token = useAuthStore((s) => s.accessToken);
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [typeFilter, setTypeFilter] = useState('');

  // User-scoped + real-money data: requires a REAL server session (never a demo one).
  const realSession = useRealSession();

  const balances = useQuery({ queryKey: ['wallet-balances'], queryFn: walletApi.balances, enabled: realSession });
  const txns = useQuery({
    queryKey: ['wallet-txns', page, typeFilter],
    queryFn: () => walletApi.transactions({ page, limit: 10, type: typeFilter || undefined }),
    enabled: realSession,
  });
  const bonus = useQuery({ queryKey: ['wallet-bonus'], queryFn: walletApi.bonus, enabled: realSession });
  const reward = useQuery({ queryKey: ['wallet-reward'], queryFn: walletApi.reward, enabled: realSession });

  // Deterministic, backend-free economy insights (always available in demo).
  const insights = useMemo(() => walletInsights(), []);

  // Realtime balance updates.
  useEffect(() => {
    if (!token) return;
    const socket: Socket = io(`${clientConfig.wsUrl}/wallet`, {
      auth: { token },
      transports: ['websocket'],
      reconnectionAttempts: 5,
    });
    socket.on('wallet:balances', () => {
      void queryClient.invalidateQueries({ queryKey: ['wallet-balances'] });
    });
    socket.on('wallet:settlement', () => {
      void queryClient.invalidateQueries({ queryKey: ['wallet-balances'] });
      void queryClient.invalidateQueries({ queryKey: ['wallet-txns'] });
    });
    return () => {
      socket.disconnect();
    };
  }, [token, queryClient]);

  const primaryCurrency = balances.data?.wallets[0]?.currencyId ?? '';
  const main = balances.data?.wallets.find((w) => w.type === 'MAIN');
  const otherWallets = balances.data?.wallets.filter((w) => w.type !== 'MAIN') ?? [];

  // A demo session has no server wallet/ledger — show the real-account notice instead of an
  // endless empty state (the api-client blocks these endpoints for demo sessions regardless).
  if (!realSession) return <RealAccountRequired />;

  return (
    <div className="space-y-6">
      <PageHeader title="Wallet" description="Balances, transfers and history — every movement is double-entry ledgered." />

      {balances.isLoading ? (
        <Spinner />
      ) : balances.data?.wallets.length === 0 ? (
        <Card className="card-premium">
          <CardContent className="flex h-32 items-center justify-center text-sm text-muted-foreground">
            No wallets yet — play a game or claim a bonus to get started.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {/* Hero balance */}
          {main ? <BalanceHero wallet={main} /> : null}

          {/* Other wallet tiles */}
          {otherWallets.length > 0 ? (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {otherWallets.map((w) => (
                <BalanceCard key={w.id} wallet={w} />
              ))}
            </div>
          ) : null}
        </div>
      )}

      {/* Economy insights — deterministic, available even without a backend. */}
      <section className="space-y-4">
        <h2 className="flex items-center gap-2 font-display text-xl font-bold md:text-2xl">
          <Sparkles className="h-5 w-5 text-violet" /> Economy insights
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <WalletInsight icon={<TrendingUp className="h-5 w-5" />} label="Earned today" value={insights.earnedToday} prefix="+" tone="text-emerald" index={0} />
          <WalletInsight icon={<Coins className="h-5 w-5" />} label="This week" value={insights.earnedWeek} prefix="+" tone="text-accent" index={1} />
          <WalletInsight icon={<Coins className="h-5 w-5" />} label="This month" value={insights.earnedMonth} prefix="+" tone="text-violet" index={2} />
          <WalletInsight icon={<Trophy className="h-5 w-5" />} label="Largest win" value={insights.largestWin} prefix="+" tone="text-gold" index={3} />
        </div>
        <div className="grid gap-4 lg:grid-cols-3">
          <Card className="card-premium">
            <CardHeader>
              <CardTitle className="font-display text-base text-gradient">Coin sources</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2.5">
              {insights.sources.map((src) => (
                <div key={src.label}>
                  <div className="mb-1 flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">{src.label}</span>
                    <span className="font-mono tabular-nums">{src.pct}%</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-black/5">
                    <div className={cn('h-full rounded-full shadow-glow-sm', src.tone)} style={{ width: `${src.pct}%` }} />
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
          <Card className="card-premium">
            <CardHeader>
              <CardTitle className="font-display text-base text-gradient">Recent rewards</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {insights.recentRewards.map((r) => (
                <div key={r.label} className="flex items-center justify-between rounded-lg bg-black/[0.03] px-3 py-2 text-sm">
                  <span className="flex items-center gap-2 text-muted-foreground">
                    <Gift className="h-3.5 w-3.5 text-gold" />
                    {r.label}
                  </span>
                  <span className="font-mono font-bold tabular-nums text-emerald">+{r.amount.toLocaleString('en-US')}</span>
                </div>
              ))}
            </CardContent>
          </Card>
          <Card className="card-premium">
            <CardHeader>
              <CardTitle className="font-display text-base text-gradient">Recent purchases</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {insights.recentPurchases.map((p, i) => (
                <div key={i} className="flex items-center justify-between gap-2 rounded-lg bg-black/[0.03] px-3 py-2 text-sm">
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="truncate">{p.item}</span>
                    <RarityBadge rarity={p.rarity} />
                  </span>
                  <span className="shrink-0 font-mono font-bold tabular-nums text-pink">−{p.amount.toLocaleString('en-US')}</span>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </section>

      {/* Platform economy dashboard */}
      <Card className="card-premium">
        <CardHeader>
          <CardTitle className="font-display text-gradient">Platform economy</CardTitle>
        </CardHeader>
        <CardContent>
          <EconomyDashboard />
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-3">
        <TransferCard currencyId={primaryCurrency} available={main?.available ?? '0'} />
        <BonusCard wallets={bonus.data ?? []} />
        <RewardCard points={reward.data?.pointsBalance ?? '0'} multiplier={reward.data?.tierMultiplier ?? '1'} />
      </div>

      <Card className="card-premium">
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="font-display text-gradient">Transaction history</CardTitle>
          <select
            className="glass h-8 rounded-md border border-black/10 bg-transparent px-2 text-xs"
            value={typeFilter}
            onChange={(e) => {
              setTypeFilter(e.target.value);
              setPage(1);
            }}
          >
            <option value="">All types</option>
            {['GAME_BET', 'GAME_WIN', 'DEPOSIT', 'WITHDRAWAL', 'TRANSFER_IN', 'TRANSFER_OUT', 'BONUS_CREDIT', 'ADMIN_ADJUSTMENT'].map((t) => (
              <option key={t} value={t}>
                {t.replace(/_/g, ' ')}
              </option>
            ))}
          </select>
        </CardHeader>
        <CardContent>
          {txns.isLoading ? (
            <Spinner />
          ) : txns.data && txns.data.items.length > 0 ? (
            <>
              <CashFlowChart items={txns.data.items} />
              <div className="mt-4 overflow-hidden rounded-xl border border-black/10">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-black/10 bg-white/[0.03] text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                      <th className="px-4 py-2 font-semibold">Type</th>
                      <th className="px-4 py-2 font-semibold">Date · Reference</th>
                      <th className="px-4 py-2 text-right font-semibold">Amount</th>
                      <th className="px-4 py-2 text-right font-semibold">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {txns.data.items.map((t) => {
                      const credit = CREDIT_TYPES.includes(t.type);
                      return (
                        <tr key={t.id} className="border-b border-black/5 transition-colors last:border-0 hover:bg-black/5">
                          <td className="px-4 py-3 font-medium">{t.type.replace(/_/g, ' ')}</td>
                          <td className="px-4 py-3 text-xs text-muted-foreground">
                            {new Date(t.createdAt).toLocaleString('en-US')} · {t.reference}
                          </td>
                          <td
                            className={cn(
                              'px-4 py-3 text-right font-mono font-semibold tabular-nums',
                              credit ? 'text-emerald' : 'text-destructive',
                            )}
                          >
                            {t.amount}
                          </td>
                          <td className="px-4 py-3 text-right">
                            <Badge variant={t.status === 'COMPLETED' || t.status === 'SETTLED' ? 'success' : 'secondary'}>
                              {t.status}
                            </Badge>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="mt-4 flex items-center justify-between text-sm">
                <span className="text-muted-foreground">
                  Page {txns.data.page} of {txns.data.pages || 1}
                </span>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                    Previous
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page >= (txns.data.pages || 1)}
                    onClick={() => setPage((p) => p + 1)}
                  >
                    Next
                  </Button>
                </div>
              </div>
            </>
          ) : (
            <p className="py-8 text-center text-sm text-muted-foreground">No transactions yet.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function BalanceHero({ wallet }: { wallet: WalletView }) {
  const numeric = Number(wallet.available);
  return (
    <div className="card-premium sheen relative overflow-hidden p-6 sm:p-8 animate-fade-up">
      <div className="bg-aurora pointer-events-none absolute inset-0 opacity-[0.15]" />
      <div className="pointer-events-none absolute -right-16 -top-20 h-64 w-64 rounded-full bg-gradient-to-br from-gold to-warning opacity-20 blur-3xl animate-glow-pulse" />
      <div className="relative flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <span className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-gold to-warning text-white shadow-glow-gold">
              <WalletIcon className="h-4 w-4" />
            </span>
            {TYPE_LABEL[wallet.type] ?? wallet.type} balance
            {wallet.status !== 'ACTIVE' ? <Badge variant="warning">{wallet.status}</Badge> : null}
          </span>
          <p className="mt-3 font-display text-5xl font-bold tabular-nums text-gradient-gold sm:text-6xl">
            {Number.isFinite(numeric) ? (
              <AnimatedNumber value={numeric} decimals={2} />
            ) : (
              wallet.available
            )}
          </p>
          <div className="mt-3 flex flex-wrap gap-4 text-xs text-muted-foreground">
            <span>
              Locked <span className="font-mono tabular-nums text-foreground">{wallet.locked}</span>
            </span>
            <span>
              Pending <span className="font-mono tabular-nums text-foreground">{wallet.pending}</span>
            </span>
          </div>
        </div>
        <div className="flex gap-3">
          <Button variant="gold" size="lg" className="shadow-glow-gold">
            Deposit
          </Button>
          <Button variant="glass" size="lg">
            Withdraw
          </Button>
        </div>
      </div>
    </div>
  );
}

function BalanceCard({ wallet }: { wallet: WalletView }) {
  return (
    <div
      className={cn(
        'card-premium sheen group relative overflow-hidden p-4',
        wallet.status !== 'ACTIVE' && 'opacity-60',
      )}
    >
      <div className="pointer-events-none absolute -right-6 -top-8 h-24 w-24 rounded-full bg-gradient-to-br from-primary to-violet opacity-15 blur-2xl transition-opacity group-hover:opacity-30" />
      <div className="relative mb-1 flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          <span className="flex h-6 w-6 items-center justify-center rounded-md bg-gradient-to-br from-primary to-violet text-white shadow-glow-sm">
            <WalletIcon className="h-3 w-3" />
          </span>
          {TYPE_LABEL[wallet.type] ?? wallet.type}
        </span>
        {wallet.status !== 'ACTIVE' ? <Badge variant="warning">{wallet.status}</Badge> : null}
      </div>
      <p className="relative mt-2 font-display text-2xl font-bold tabular-nums text-gradient">{wallet.available}</p>
      <div className="relative mt-1 flex gap-3 text-[11px] text-muted-foreground">
        <span>locked {wallet.locked}</span>
        <span>pending {wallet.pending}</span>
      </div>
    </div>
  );
}

function TransferCard({ currencyId, available }: { currencyId: string; available: string }) {
  const queryClient = useQueryClient();
  const [fromType, setFromType] = useState('MAIN');
  const [toType, setToType] = useState('CASH');
  const [amount, setAmount] = useState('');

  const transfer = useMutation({
    mutationFn: () => walletApi.transfer({ currencyId, fromType, toType, amount }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['wallet-balances'] });
      setAmount('');
      toast.success('Transfer complete');
    },
    onError: (e: { message?: string }) => toast.error(e?.message ?? 'Transfer failed'),
  });

  return (
    <Card className="card-premium">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 font-display text-base">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-accent to-primary text-white shadow-glow-neon">
            <ArrowLeftRight className="h-4 w-4" />
          </span>
          <span className="text-gradient">Transfer</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-2 gap-2">
          <select className="glass h-9 rounded-md border border-black/10 bg-transparent px-2 text-sm" value={fromType} onChange={(e) => setFromType(e.target.value)}>
            {['MAIN', 'CASH', 'BONUS', 'TOURNAMENT', 'PROMOTIONAL'].map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <select className="glass h-9 rounded-md border border-black/10 bg-transparent px-2 text-sm" value={toType} onChange={(e) => setToType(e.target.value)}>
            {['CASH', 'MAIN', 'TOURNAMENT', 'PROMOTIONAL', 'VIRTUAL'].map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <Input type="number" min="0" placeholder="Amount" value={amount} onChange={(e) => setAmount(e.target.value)} />
        <p className="text-xs text-muted-foreground">Available: <span className="font-mono tabular-nums text-foreground">{available}</span></p>
        <Button
          variant="gradient"
          className="w-full"
          disabled={!currencyId || !amount || transfer.isPending}
          onClick={() => transfer.mutate()}
        >
          {transfer.isPending ? <Spinner size={16} /> : 'Transfer'}
        </Button>
      </CardContent>
    </Card>
  );
}

function BonusCard({
  wallets,
}: {
  wallets: Array<{ id: string; balance: string; wageringProgress: string; wageringRequirement: string }>;
}) {
  const queryClient = useQueryClient();
  const convert = useMutation({
    mutationFn: (id: string) => walletApi.convertBonus(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['wallet-bonus'] });
      void queryClient.invalidateQueries({ queryKey: ['wallet-balances'] });
      toast.success('Bonus converted');
    },
    onError: (e: { message?: string }) => toast.error(e?.message ?? 'Cannot convert yet'),
  });

  return (
    <Card className="card-premium">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 font-display text-base">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-pink to-violet text-white shadow-glow">
            <Gift className="h-4 w-4" />
          </span>
          <span className="text-gradient">Bonus wallets</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {wallets.length === 0 ? (
          <p className="text-sm text-muted-foreground">No active bonuses.</p>
        ) : (
          wallets.map((b) => {
            const pct =
              Number(b.wageringRequirement) > 0
                ? Math.min(100, (Number(b.wageringProgress) / Number(b.wageringRequirement)) * 100)
                : 100;
            return (
              <div key={b.id} className="glass rounded-xl border border-black/10 p-3">
                <div className="flex items-center justify-between text-sm">
                  <span className="font-mono font-semibold tabular-nums text-pink">{b.balance}</span>
                  <Button size="sm" variant="outline" disabled={pct < 100} onClick={() => convert.mutate(b.id)}>
                    Convert
                  </Button>
                </div>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-black/5">
                  <div className="h-full rounded-full bg-gradient-to-r from-pink to-violet shadow-glow-sm" style={{ width: `${pct}%` }} />
                </div>
                <p className="mt-1 text-[11px] text-muted-foreground">Wagering {Math.round(pct)}%</p>
              </div>
            );
          })
        )}
      </CardContent>
    </Card>
  );
}

function RewardCard({ points, multiplier }: { points: string; multiplier: string }) {
  return (
    <Card className="card-premium">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 font-display text-base">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-gold to-warning text-white shadow-glow-gold">
            <Star className="h-4 w-4" />
          </span>
          <span className="text-gradient-gold">Reward wallet</span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="font-display text-3xl font-bold tabular-nums text-gradient-gold">{points}</p>
        <p className="mt-1 text-xs text-muted-foreground">
          loyalty points · <span className="text-gold">{multiplier}× tier multiplier</span>
        </p>
      </CardContent>
    </Card>
  );
}

function CashFlowChart({ items }: { items: Array<{ amount: string; type: string }> }) {
  const bars = useMemo(() => items.slice(0, 20).reverse(), [items]);
  const max = Math.max(1, ...bars.map((b) => Number(b.amount)));
  return (
    <div className="glass flex h-16 items-end gap-1 rounded-xl border border-black/10 p-2">
      {bars.map((b, i) => {
        const credit = CREDIT_TYPES.includes(b.type);
        return (
          <div
            key={i}
            className={cn(
              'flex-1 rounded-t bg-gradient-to-t',
              credit ? 'from-emerald/40 to-emerald shadow-glow-neon' : 'from-destructive/40 to-destructive',
            )}
            style={{ height: `${Math.max(4, (Number(b.amount) / max) * 100)}%` }}
            title={`${b.type} ${b.amount}`}
          />
        );
      })}
    </div>
  );
}
