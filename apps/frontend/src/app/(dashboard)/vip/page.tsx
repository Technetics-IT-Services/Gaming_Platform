'use client';

import { Badge, cn } from '@gaming-platform/ui';
import { motion } from 'framer-motion';
import { Calendar, Check, Coins, Crown, Gem, Gift, Lock, Sparkles, Target, TrendingUp, Trophy, Users } from 'lucide-react';

import { ProgressRing } from '@/components/career/progress-ring';
import { AnimatedNumber } from '@/components/marketing/animated-number';
import { VIP_TIERS, type VipTier, vipMissions, vipRewards, vipStats, vipStatus } from '@/lib/vip';

export default function VipPage() {
  const status = vipStatus();
  const tier = VIP_TIERS[status.tierIndex]!;
  const next = VIP_TIERS[status.tierIndex + 1] ?? tier;
  const rewards = vipRewards();
  const missions = vipMissions();
  const stats = vipStats();

  return (
    <div className="space-y-8">
      {/* Hero */}
      <motion.section
        initial={{ opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="card-premium relative overflow-hidden rounded-3xl border border-gold/20 shadow-elevated"
      >
        <div className="absolute inset-0 bg-gradient-to-br from-gold/15 via-primary/5 to-violet/10" />
        <div className="bg-grid absolute inset-0 opacity-[0.12]" />
        <div className="pointer-events-none absolute -right-16 -top-20 h-64 w-64 rounded-full bg-gold/25 blur-3xl animate-glow-pulse" />
        <div className="pointer-events-none absolute -left-10 bottom-0 h-56 w-56 rounded-full bg-violet/15 blur-3xl" />

        <div className="relative flex flex-col gap-6 p-6 sm:p-8 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-5">
            <ProgressRing pct={status.progressPct} size={116} stroke={10} from="hsl(var(--gold))" via="hsl(var(--warning))" to="hsl(var(--pink))">
              <Crown className="h-6 w-6 text-gold" />
              <span className="mt-0.5 font-display text-lg font-bold tabular-nums">{status.progressPct}%</span>
            </ProgressRing>
            <div className="space-y-2">
              <Badge variant="gold" className="shadow-glow-gold">★ VIP Member</Badge>
              <h1 className="font-display text-3xl font-extrabold sm:text-4xl">
                <span className="text-gradient-gold text-glow">{tier.name} Tier</span>
              </h1>
              <p className="text-sm text-muted-foreground">
                <span className="font-mono tabular-nums text-foreground">{(status.nextRequirement - status.points).toLocaleString('en-US')}</span>{' '}
                points to <span className="font-semibold text-gold">{next.name}</span>
              </p>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <HeroStat icon={<Coins className="h-4 w-4" />} label="Cashback" value={tier.cashback} suffix="%" tone="text-gold" />
            <HeroStat icon={<Gift className="h-4 w-4" />} label="Weekly" value={tier.weekly} tone="text-emerald" />
            <HeroStat icon={<Calendar className="h-4 w-4" />} label="Monthly" value={tier.monthly} tone="text-accent" />
          </div>
        </div>
      </motion.section>

      {/* Tier overview */}
      <section className="space-y-4">
        <h2 className="flex items-center gap-2 font-display text-2xl font-bold">
          <Gem className="h-5 w-5 text-gold" /> VIP Tiers
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {VIP_TIERS.map((t, i) => (
            <TierCard key={t.key} tier={t} current={i === status.tierIndex} unlocked={i <= status.tierIndex} index={i} />
          ))}
        </div>
      </section>

      {/* Rewards + missions */}
      <div className="grid gap-6 lg:grid-cols-2">
        <section className="card-premium space-y-4 p-6">
          <h2 className="flex items-center gap-2 font-display text-lg font-bold text-gradient">
            <Gift className="h-5 w-5 text-gold" /> Recent rewards
          </h2>
          <ul className="space-y-2">
            {rewards.map((r) => (
              <li key={r.label} className="flex items-center justify-between rounded-xl bg-black/[0.03] px-3 py-2.5 text-sm">
                <span className="flex items-center gap-2 text-muted-foreground">
                  <Sparkles className="h-3.5 w-3.5 text-gold" /> {r.label}
                  <span className="text-[11px] text-muted-foreground">· {r.when}</span>
                </span>
                <span className="font-mono font-bold tabular-nums text-emerald">+{r.amount.toLocaleString('en-US')}</span>
              </li>
            ))}
          </ul>
        </section>

        <section className="card-premium space-y-4 p-6">
          <h2 className="flex items-center gap-2 font-display text-lg font-bold text-gradient">
            <Target className="h-5 w-5 text-violet" /> VIP missions
          </h2>
          <div className="space-y-3">
            {missions.map((m) => {
              const pct = Math.min(100, Math.round((m.progress / m.target) * 100));
              return (
                <div key={m.id}>
                  <div className="mb-1 flex items-center justify-between text-xs">
                    <span className="font-medium">{m.label}</span>
                    <span className="font-mono tabular-nums text-gold">+{m.reward.toLocaleString('en-US')}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="h-2 flex-1 overflow-hidden rounded-full bg-black/5">
                      <motion.div
                        initial={{ width: 0 }}
                        whileInView={{ width: `${pct}%` }}
                        viewport={{ once: true }}
                        transition={{ duration: 0.9, ease: 'easeOut' }}
                        className="h-full rounded-full bg-gradient-to-r from-gold to-warning shadow-glow-sm"
                      />
                    </div>
                    <span className="w-9 shrink-0 text-right font-mono text-[11px] tabular-nums text-muted-foreground">{pct}%</span>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      </div>

      {/* Stats */}
      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile icon={<Coins className="h-5 w-5" />} label="Total cashback" value={stats.totalCashback} prefix="$" tone="text-gold" />
        <StatTile icon={<Trophy className="h-5 w-5" />} label="Rewards claimed" value={stats.rewardsClaimed} tone="text-emerald" />
        <StatTile icon={<Calendar className="h-5 w-5" />} label="VIP for (days)" value={stats.vipSince} tone="text-accent" />
        <StatTile icon={<Users className="h-5 w-5" />} label="VIP rank" value={stats.rank} prefix="#" tone="text-violet" />
      </section>
    </div>
  );
}

function HeroStat({ icon, label, value, suffix, tone }: { icon: React.ReactNode; label: string; value: number; suffix?: string; tone: string }) {
  return (
    <div className="glass rounded-2xl px-3 py-2.5">
      <span className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
        <span className={tone}>{icon}</span> {label}
      </span>
      <p className={cn('mt-0.5 font-mono text-lg font-bold tabular-nums', tone)}>
        <AnimatedNumber value={value} suffix={suffix} />
      </p>
    </div>
  );
}

function StatTile({ icon, label, value, prefix, tone }: { icon: React.ReactNode; label: string; value: number; prefix?: string; tone: string }) {
  return (
    <div className="glass flex items-center gap-3 rounded-2xl px-4 py-3.5">
      <span className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-black/[0.04]', tone)}>{icon}</span>
      <div className="min-w-0">
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
        <p className={cn('font-mono text-base font-bold tabular-nums', tone)}>
          <AnimatedNumber value={value} prefix={prefix} />
        </p>
      </div>
    </div>
  );
}

function TierCard({ tier, current, unlocked, index }: { tier: VipTier; current: boolean; unlocked: boolean; index: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-40px' }}
      transition={{ duration: 0.3, delay: Math.min(index * 0.04, 0.3) }}
      whileHover={{ y: -4 }}
      className={cn(
        'card-premium flex flex-col overflow-hidden p-0',
        current && cn('ring-2 shadow-glow', tier.ring),
        !unlocked && 'opacity-80',
      )}
    >
      <div className={cn('relative h-16 bg-gradient-to-br', tier.gradient)}>
        <div className="bg-grid absolute inset-0 opacity-20" />
        <Crown className="absolute -bottom-2 right-3 h-14 w-14 text-white/25" />
        <div className="absolute left-4 top-3 flex items-center gap-2">
          <span className="font-display text-lg font-black text-white drop-shadow">{tier.name}</span>
          {current ? <Badge variant="gold">Current</Badge> : unlocked ? <Badge variant="new">Unlocked</Badge> : null}
        </div>
      </div>
      <div className="flex flex-1 flex-col gap-3 p-4">
        <div className="flex items-center gap-3 text-xs">
          <span className="inline-flex items-center gap-1 font-semibold text-gold">
            <Coins className="h-3.5 w-3.5" /> {tier.cashback}% cashback
          </span>
          <span className="inline-flex items-center gap-1 text-muted-foreground">
            <TrendingUp className="h-3.5 w-3.5" /> {tier.weekly.toLocaleString('en-US')}/wk
          </span>
        </div>
        <ul className="space-y-1.5">
          {tier.benefits.map((b) => (
            <li key={b} className="flex items-start gap-2 text-xs text-muted-foreground">
              <Check className="mt-0.5 h-3 w-3 shrink-0 text-emerald" /> {b}
            </li>
          ))}
        </ul>
        <div className="mt-auto flex items-center gap-1.5 border-t border-black/5 pt-2 text-[11px] text-muted-foreground">
          {unlocked ? <Check className="h-3.5 w-3.5 text-emerald" /> : <Lock className="h-3.5 w-3.5" />}
          {tier.requirement === 0 ? 'Starter tier' : `${tier.requirement.toLocaleString('en-US')} points`}
        </div>
      </div>
    </motion.div>
  );
}
