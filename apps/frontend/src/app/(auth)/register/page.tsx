'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { Button, Input, Label, Spinner } from '@gaming-platform/ui';
import { registerSchema, type RegisterInput } from '@gaming-platform/shared/schemas';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';

import { PasswordStrengthMeter } from '@/components/auth/password-strength-meter';
import { authApi } from '@/lib/auth-api';
import { clientConfig } from '@/lib/config';
import { createDemoSession, persistDemoSession } from '@/lib/demo-session';
import { notifyLogin } from '@/lib/auth-session';
import { useAuthStore } from '@/stores/auth-store';
import { usePlayerProfile } from '@/stores/player-profile';

export default function RegisterPage() {
  const router = useRouter();
  const setSession = useAuthStore((s) => s.setSession);
  const setDemoSession = useAuthStore((s) => s.setDemoSession);

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<RegisterInput>({
    resolver: zodResolver(registerSchema),
    defaultValues: { email: '', username: '', password: '' },
  });

  const password = watch('password');

  const onSubmit = async (values: RegisterInput) => {
    // Demo mode: create a local session (no backend) and enter the app.
    if (clientConfig.demoMode && values.email.trim() && values.password.trim()) {
      const { user } = createDemoSession(values.email.trim());
      setDemoSession(user); // explicitly-marked client-only session (see login page)
      persistDemoSession(values.email.trim());
      usePlayerProfile.getState().setUsername(values.username || values.email.split('@')[0] || 'player');
      toast.success('Account created — welcome!');
      router.push('/dashboard');
      return;
    }

    try {
      const session = await authApi.register(values);
      notifyLogin();
      setSession(session.user, session.tokens.accessToken);
      toast.success('Account created! Check your email to verify your address.');
      router.push('/dashboard');
    } catch (error) {
      toast.error((error as { message?: string })?.message ?? 'Unable to create account');
    }
  };

  return (
    <div className="space-y-6">
      <div className="space-y-1 text-center">
        <h1 className="font-display text-3xl font-bold tracking-tight">
          Join the <span className="text-gradient">action</span>
        </h1>
        <p className="text-sm text-muted-foreground">Create your account and claim your bonus</p>
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <Input id="email" type="email" autoComplete="email" {...register('email')} />
          {errors.email ? <p className="text-xs text-destructive">{errors.email.message}</p> : null}
        </div>

        <div className="space-y-2">
          <Label htmlFor="username">Username</Label>
          <Input id="username" autoComplete="username" {...register('username')} />
          {errors.username ? (
            <p className="text-xs text-destructive">{errors.username.message}</p>
          ) : null}
        </div>

        <div className="space-y-2">
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            type="password"
            autoComplete="new-password"
            {...register('password')}
          />
          <PasswordStrengthMeter password={password} />
          {errors.password ? (
            <p className="text-xs text-destructive">{errors.password.message}</p>
          ) : null}
        </div>

        <Button type="submit" variant="gradient" className="w-full" disabled={isSubmitting}>
          {isSubmitting ? <Spinner size={18} /> : 'Create account'}
        </Button>
      </form>

      <p className="text-center text-sm text-muted-foreground">
        Already have an account?{' '}
        <Link href="/login" className="font-medium text-primary hover:underline">
          Sign in
        </Link>
      </p>
    </div>
  );
}
