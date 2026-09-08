/**
 * Deterministic VIP-program data (tiers, benefits, progress, rewards, missions).
 * Pure — no `Date.now()` / `Math.random()` — so SSR and client agree with no
 * hydration drift. Backend-free; presentation only.
 */

export interface VipTier {
  key: string;
  name: string;
  cashback: number;
  weekly: number;
  monthly: number;
  requirement: number;
  gradient: string;
  ring: string;
  benefits: string[];
}

export const VIP_TIERS: VipTier[] = [
  {
    key: 'bronze', name: 'Bronze', cashback: 3, weekly: 500, monthly: 2_000, requirement: 0,
    gradient: 'from-amber-800 to-amber-700', ring: 'ring-amber-500/40',
    benefits: ['3% weekly cashback', 'Level-up rewards', 'Standard support'],
  },
  {
    key: 'silver', name: 'Silver', cashback: 5, weekly: 1_500, monthly: 6_000, requirement: 10_000,
    gradient: 'from-slate-600 to-slate-500', ring: 'ring-slate-400/50',
    benefits: ['5% weekly cashback', 'Weekly reload bonus', 'Priority support'],
  },
  {
    key: 'gold', name: 'Gold', cashback: 8, weekly: 4_000, monthly: 15_000, requirement: 50_000,
    gradient: 'from-gold to-warning', ring: 'ring-gold/50',
    benefits: ['8% weekly cashback', 'Exclusive games', 'Faster withdrawals', 'Birthday bonus'],
  },
  {
    key: 'platinum', name: 'Platinum', cashback: 12, weekly: 10_000, monthly: 40_000, requirement: 200_000,
    gradient: 'from-accent to-primary', ring: 'ring-accent/50',
    benefits: ['12% weekly cashback', 'Dedicated VIP host', 'VIP tournaments', 'Custom limits'],
  },
  {
    key: 'diamond', name: 'Diamond', cashback: 18, weekly: 25_000, monthly: 100_000, requirement: 750_000,
    gradient: 'from-violet to-pink', ring: 'ring-violet/50',
    benefits: ['18% weekly cashback', 'Luxury gifts', 'Private events', 'Instant withdrawals'],
  },
  {
    key: 'elite', name: 'Elite', cashback: 25, weekly: 60_000, monthly: 250_000, requirement: 2_000_000,
    gradient: 'from-gold via-pink to-violet', ring: 'ring-gold/60',
    benefits: ['25% weekly cashback', 'Personal concierge', 'Bespoke rewards', 'Unlimited everything'],
  },
];

function hash(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export interface VipStatus {
  tierIndex: number;
  points: number;
  nextRequirement: number;
  progressPct: number;
}

/** Deterministic current VIP standing. */
export function vipStatus(seed = 'vip'): VipStatus {
  const h = hash(`vip-${seed}`);
  const tierIndex = 2; // Gold — a satisfying mid-tier for the demo
  const current = VIP_TIERS[tierIndex]!;
  const next = VIP_TIERS[tierIndex + 1] ?? current;
  const points = current.requirement + (h % (next.requirement - current.requirement || 1));
  const span = next.requirement - current.requirement || 1;
  return {
    tierIndex,
    points,
    nextRequirement: next.requirement,
    progressPct: Math.min(100, Math.round(((points - current.requirement) / span) * 100)),
  };
}

export interface VipReward {
  label: string;
  amount: number;
  when: string;
}

export function vipRewards(seed = 'vip'): VipReward[] {
  const specs = ['Weekly cashback', 'Monthly bonus', 'Tier-up gift', 'VIP mission', 'Reload bonus'];
  return specs.map((label, i) => {
    const h = hash(`vr-${seed}-${i}`);
    return { label, amount: 1_000 + (h % 40) * 500, when: `${1 + (h % 6)}d ago` };
  });
}

export interface VipMission {
  id: string;
  label: string;
  progress: number;
  target: number;
  reward: number;
}

export function vipMissions(seed = 'vip'): VipMission[] {
  const specs = [
    { id: 'wager', label: 'Wager 100,000 this week', target: 100_000, reward: 4_000 },
    { id: 'play', label: 'Play 50 rounds of Crash', target: 50, reward: 1_500 },
    { id: 'tourney', label: 'Enter 3 VIP tournaments', target: 3, reward: 6_000 },
    { id: 'daily', label: 'Log in 7 days in a row', target: 7, reward: 2_500 },
  ];
  return specs.map((s) => {
    const h = hash(`vm-${seed}-${s.id}`);
    return { ...s, progress: Math.round(s.target * ((h % 90) / 100)) };
  });
}

export interface VipStats {
  totalCashback: number;
  rewardsClaimed: number;
  vipSince: number;
  rank: number;
}

export function vipStats(seed = 'vip'): VipStats {
  const h = hash(`vs-${seed}`);
  return {
    totalCashback: 120_000 + (h % 80) * 1_000,
    rewardsClaimed: 40 + (h % 120),
    vipSince: 180 + (h % 400),
    rank: 1 + (h % 500),
  };
}
