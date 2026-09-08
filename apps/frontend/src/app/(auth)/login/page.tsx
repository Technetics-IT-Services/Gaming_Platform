'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { Button, Input, Label, Spinner } from '@gaming-platform/ui';
import { loginSchema, type LoginInput } from '@gaming-platform/shared/schemas';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';

import { authApi } from '@/lib/auth-api';
import { clientConfig } from '@/lib/config';
import { createDemoSession, persistDemoSession } from '@/lib/demo-session';
import { notifyLogin } from '@/lib/auth-session';
import { useAuthStore } from '@/stores/auth-store';
import { useDemoWallet } from '@/stores/demo-wallet';
import { usePlayerProfile } from '@/stores/player-profile';

/** One-time demo starter grant, credited as a Bonus on guest sign-in. */
const WELCOME_BONUS = 10_000;

export default function LoginPage() {
  const router = useRouter();
  const setSession = useAuthStore((s) => s.setSession);
  const setDemoSession = useAuthStore((s) => s.setDemoSession);

  /** Guest sign-in: create a demo session + generate a full player profile. */
  const enterDemo = (email: string) => {
    const { user } = createDemoSession(email);
    // setDemoSession (NOT setSession) marks the session explicitly demo and holds no credential, so
    // the api-client never authenticates as this user, never refreshes on a backend 401 and never
    // tears the session down — the Phase 2C.15 redirect loop cannot happen.
    setDemoSession(user);
    persistDemoSession(email); // survive reloads (demo mode)
    usePlayerProfile.getState().setUsername(email.split('@')[0] || 'player');
    // Welcome Bonus — new demo sessions start at ₹0; grant a starter bonus once
    // (logout resets the wallet, so each fresh guest session gets exactly one).
    const wallet = useDemoWallet.getState();
    if (wallet.balance === 0 && wallet.txnSeq === 0) {
      wallet.bonus(WELCOME_BONUS, { label: 'Welcome Bonus', source: 'welcome' });
    }
    toast.success('Welcome, player! Your guest profile is ready.');
    router.push('/dashboard');
  };

  const [challengeToken, setChallengeToken] = useState<string | null>(null);
  const [twoFactorCode, setTwoFactorCode] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);

  const {
    register,
    handleSubmit,
    getValues,
    formState: { errors, isSubmitting },
  } = useForm<LoginInput>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '' },
  });

  /**
   * In demo mode we accept ANY non-empty credentials, so a failed schema
   * validation still signs in the Demo User instead of blocking. Production
   * (demoMode off) keeps strict validation.
   */
  const onInvalid = () => {
    if (!clientConfig.demoMode) return;
    const { email, password } = getValues();
    if (!email?.trim() || !password?.trim()) return;
    enterDemo(email.trim());
  };

  const onSubmit = async (values: LoginInput) => {
    // Demo mode (development / NEXT_PUBLIC_DEMO_MODE): any non-empty email +
    // password signs in a local Demo User. Production auth is untouched.
    if (clientConfig.demoMode && values.email.trim() && values.password.trim()) {
      enterDemo(values.email.trim());
      return;
    }

    try {
      const result = await authApi.login({ ...values, rememberMe });
      if (result.requiresTwoFactor && result.challengeToken) {
        setChallengeToken(result.challengeToken);
        toast.info('Enter your two-factor code to continue.');
        return;
      }
      if (result.session) {
        notifyLogin();
        setSession(result.session.user, result.session.tokens.accessToken);
        toast.success('Welcome back!');
        router.push('/dashboard');
      }
    } catch (error) {
      toast.error((error as { message?: string })?.message ?? 'Unable to sign in');
    }
  };

  const submitTwoFactor = async () => {
    if (!challengeToken) return;
    setVerifying(true);
    try {
      const session = await authApi.verifyTwoFactorLogin({ challengeToken, code: twoFactorCode });
      notifyLogin();
      setSession(session.user, session.tokens.accessToken);
      toast.success('Welcome back!');
      router.push('/dashboard');
    } catch (error) {
      toast.error((error as { message?: string })?.message ?? 'Invalid code');
    } finally {
      setVerifying(false);
    }
  };

  if (challengeToken) {
    return (
      <div className="space-y-6">
        <div className="space-y-1 text-center">
          <h1 className="font-display text-2xl font-bold tracking-tight">
            Two-factor authentication
          </h1>
          <p className="text-sm text-muted-foreground">
            Enter the 6-digit code from your authenticator app, or a recovery code.
          </p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="code">Verification code</Label>
          <Input
            id="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            autoFocus
            // Phase 2D.2: mobile certification measured this field below the 44px comfortable touch
            // target at 375/390/412 (the shared rem scale renders smaller than nominal). Pinned in
            // explicit pixels — this is the one field standing between an operator and their account.
            style={{ minHeight: 48, fontSize: 18, letterSpacing: '0.2em', textAlign: 'center' }}
            value={twoFactorCode}
            onChange={(e) => setTwoFactorCode(e.target.value)}
          />
        </div>
        <Button
          variant="gradient"
          className="w-full"
          // Phase 2D.2: measured at 35px on mobile — pinned to the 44px comfortable touch target.
          style={{ minHeight: 48 }}
          disabled={verifying || twoFactorCode.length < 6}
          onClick={() => void submitTwoFactor()}
        >
          {verifying ? <Spinner size={18} /> : 'Verify'}
        </Button>
        <button
          type="button"
          className="w-full text-center text-sm text-muted-foreground hover:text-foreground"
          style={{ minHeight: 44 }}
          onClick={() => setChallengeToken(null)}
        >
          Back to sign in
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="space-y-1 text-center">
        <h1 className="font-display text-3xl font-bold tracking-tight">
          Welcome <span className="text-gradient">back</span>
        </h1>
        <p className="text-sm text-muted-foreground">Sign in to keep playing</p>
      </div>

      <form onSubmit={handleSubmit(onSubmit, onInvalid)} className="space-y-4" noValidate>
        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <Input id="email" type="email" autoComplete="email" {...register('email')} />
          {errors.email ? <p className="text-xs text-destructive">{errors.email.message}</p> : null}
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="password">Password</Label>
            <Link
              href="/forgot-password"
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              Forgot password?
            </Link>
          </div>
          <Input
            id="password"
            type="password"
            autoComplete="current-password"
            {...register('password')}
          />
          {errors.password ? (
            <p className="text-xs text-destructive">{errors.password.message}</p>
          ) : null}
        </div>

        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <input
            type="checkbox"
            className="h-4 w-4 rounded border-input bg-background accent-primary"
            checked={rememberMe}
            onChange={(e) => setRememberMe(e.target.checked)}
          />
          Remember me on this device
        </label>

        <Button type="submit" variant="gradient" className="w-full" disabled={isSubmitting}>
          {isSubmitting ? <Spinner size={18} /> : 'Sign in'}
        </Button>
      </form>

      {clientConfig.demoMode ? (
        <button
          type="button"
          onClick={() => enterDemo('guest@player.gg')}
          className="w-full rounded-xl border border-dashed border-primary/40 bg-primary/5 px-4 py-2.5 text-center text-sm font-medium text-primary transition-colors hover:bg-primary/10"
        >
          ✨ Continue as Demo Player — any email &amp; password works
        </button>
      ) : null}

      <p className="text-center text-sm text-muted-foreground">
        Don&apos;t have an account?{' '}
        <Link href="/register" className="font-medium text-primary hover:underline">
          Create one
        </Link>
      </p>
    </div>
  );
}
