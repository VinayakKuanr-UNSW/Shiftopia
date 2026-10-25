import { PageState } from '@/modules/core/ui/components/PageState';
import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useToast } from '@/modules/core/hooks/use-toast';
import { useAuth } from '@/platform/auth/useAuth';
import { Mail, Lock, Loader2, AlertCircle, Eye, EyeOff, ShieldCheck } from 'lucide-react';
import { Button } from '@/modules/core/ui/primitives/button';
import { supabase } from '@/platform/supabase/client';
import { Input } from '@/modules/core/ui/primitives/input';

/**
 * Remembered email, for prefill only.
 *
 * NOT a session control. `persistSession: true` is set globally on the Supabase
 * client, so every session already survives a browser restart — a "Remember me"
 * that claimed to govern that would be describing behaviour the user gets either
 * way. This stores the address and nothing else: no password, no token.
 */
const REMEMBERED_EMAIL_KEY = 'icc-remembered-email';

const LoginPage: React.FC = () => {
  const [email, setEmail] = useState(() => {
    try {
      return localStorage.getItem(REMEMBERED_EMAIL_KEY) ?? '';
    } catch {
      return '';   // private browsing / storage disabled
    }
  });
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [isResetting, setIsResetting] = useState(false);
  const [rememberEmail, setRememberEmail] = useState(() => {
    try {
      return Boolean(localStorage.getItem(REMEMBERED_EMAIL_KEY));
    } catch {
      return false;
    }
  });

  const navigate = useNavigate();
  const location = useLocation();
  const { toast } = useToast();
  const { login, isAuthenticated, isLoading, error: authError } = useAuth();

  useEffect(() => {
    if (isAuthenticated && !isLoading) {
      const from = (location.state as any)?.from?.pathname || '/my-roster';
      navigate(from, { replace: true });
    }
  }, [isAuthenticated, isLoading, navigate, location]);

  /**
   * Password reset from the login screen.
   *
   * This used to be a <Link to="/forgot-password">, which no route has ever
   * served — every click landed on NotFound. There is no reset PAGE to route to
   * either, and there does not need to be: Supabase mails a recovery link that
   * signs the user in and returns them to `redirectTo`, so pointing that at the
   * security settings tab lands them exactly where the password field already
   * lives. Same call and same destination SettingsPage uses for a signed-in
   * user, so there is one reset mechanism rather than two.
   */
  const handleForgotPassword = async () => {
    if (!email.trim()) {
      setLoginError('Enter your email address first, then choose "Forgot password?"');
      return;
    }

    setIsResetting(true);
    setLoginError(null);

    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: `${window.location.origin}/settings/security`,
      });
      if (error) throw error;

      toast({
        title: 'Reset email sent',
        description: `If an account exists for ${email.trim()}, a reset link is on its way.`,
      });
    } catch (err: any) {
      setLoginError(err.message || 'Could not send the reset email. Try again shortly.');
    } finally {
      setIsResetting(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!email.trim() || !password) {
      setLoginError('Please enter both email and password');
      return;
    }

    setIsSubmitting(true);
    setLoginError(null);

    try {
      await login(email.trim(), password);

      try {
        if (rememberEmail) localStorage.setItem(REMEMBERED_EMAIL_KEY, email.trim());
        else localStorage.removeItem(REMEMBERED_EMAIL_KEY);
      } catch {
        /* storage unavailable — prefill is a convenience, never a blocker */
      }

      toast({
        title: 'Welcome back!',
        description: 'You have successfully signed in.',
      });

      const from = (location.state as any)?.from?.pathname || '/my-roster';
      navigate(from, { replace: true });
    } catch (err: any) {
      setLoginError(err.message || 'Invalid email or password');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background safe-area-top safe-area-bottom safe-area-x">
        <PageState state="loading" scope="page" title="Loading" />
      </div>
    );
  }

  return (
    <div className="min-h-screen w-full flex flex-col md:flex-row bg-background font-sans safe-area-top safe-area-bottom safe-area-x">

      {/* LEFT SIDE */}
      <motion.div
        initial={{ opacity: 0, x: -20 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.8 }}
        className="hidden md:flex md:w-1/2 relative overflow-hidden md:rounded-l-2xl"
      >
        {/* Image */}
        <img
          src="/auth-bg.jpeg"
          alt="Background"
          className="absolute inset-0 w-full h-full object-cover scale-105"
        />

        {/* Gradient overlay */}
        <div className="absolute inset-0 bg-gradient-to-t from-[#0f1113]/80 via-transparent to-transparent" />

        {/* Inner shadow (premium depth) */}
        <div className="absolute inset-0 shadow-[inset_0_0_120px_rgba(0,0,0,0.6)]" />

        {/* Content */}
        <div className="absolute bottom-12 left-12 z-10">
          <div className="flex items-center gap-2 mb-4">
            <div className="w-8 h-8 rounded-lg bg-white/10 backdrop-blur-md flex items-center justify-center border border-white/20">
              <ShieldCheck className="w-5 h-5 text-purple-400" />
            </div>
            <span className="text-white/80 text-[11px] uppercase tracking-wider">
              Enterprise Grade Security
            </span>
          </div>

          <h2 className="text-[36px] font-bold text-white mb-2 leading-tight">
            Manage your workforce <br /> with intelligence.
          </h2>

          <p className="text-white/75 text-[17px] max-w-md">
            The ultimate platform for shift scheduling and labor optimization.
          </p>
        </div>

        {/* Glass divider edge */}
        <div className="absolute right-0 top-0 h-full w-[2px] bg-white/10 backdrop-blur-md" />
      </motion.div>

      {/* RIGHT SIDE */}
      <motion.div
        initial={{ opacity: 0, x: 20 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.8 }}
        className="flex-1 flex items-center justify-center p-6 md:p-12 bg-background"
      >
        <div className="w-full max-w-md">

          {/* Header */}
          <header className="mb-10">
            <h1 className="text-[28px] font-bold text-foreground mb-3">Sign In</h1>
            <p className="text-[14px] text-muted-foreground">
              Don&apos;t have an account?{' '}
              <Link
                to="/signup"
                className="font-medium text-primary hover:text-primary/80 underline underline-offset-4"
              >
                Create one
              </Link>
            </p>
          </header>

          {/* Error */}
          <AnimatePresence>
            {(loginError || authError) && (
              <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                role="alert"
                className="mb-6 p-4 rounded-xl bg-red-500/10 border border-red-500/20 flex items-center gap-3 text-red-700 dark:text-red-400 text-[13px]"
              >
                <AlertCircle className="w-5 h-5 shrink-0" aria-hidden="true" />
                <p>{loginError || authError}</p>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-5">

            {/* Email */}
            <div>
              <label htmlFor="login-email" className="text-[13px] font-medium text-foreground">Email Address</label>
              <div className="relative mt-2">
                <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" aria-hidden="true" />
                <Input
                  id="login-email"
                  type="email"
                  autoComplete="email"
                  inputMode="email"
                  placeholder="name@company.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="h-[48px] md:h-[48px] pl-12 rounded-xl"
                />
              </div>
            </div>

            {/* Password */}
            <div>
              <label htmlFor="login-password" className="text-[13px] font-medium text-foreground">Password</label>
              <div className="relative mt-2">
                <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" aria-hidden="true" />
                <Input
                  id="login-password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  placeholder="Enter your password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="h-[48px] md:h-[48px] pl-12 pr-14 rounded-xl"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  aria-pressed={showPassword}
                  className="absolute right-1 top-1/2 -translate-y-1/2 flex h-[44px] w-[44px] items-center justify-center rounded-lg text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {showPassword ? <EyeOff className="h-5 w-5" aria-hidden="true" /> : <Eye className="h-5 w-5" aria-hidden="true" />}
                </button>
              </div>
            </div>

            {/* Actions */}
            <div className="flex items-center justify-between text-[13px]">
              <label htmlFor="remember-email" className="flex min-h-[44px] items-center gap-2 text-muted-foreground cursor-pointer">
                <input
                  id="remember-email"
                  type="checkbox"
                  className="w-4 h-4 cursor-pointer"
                  checked={rememberEmail}
                  onChange={(e) => setRememberEmail(e.target.checked)}
                />
                Remember my email
              </label>

              <button
                type="button"
                onClick={handleForgotPassword}
                disabled={isResetting}
                className="min-h-[44px] font-medium text-primary hover:text-primary/80 disabled:opacity-60 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
              >
                {isResetting ? 'Sending…' : 'Forgot password?'}
              </button>
            </div>

            {/* Button */}
            <Button
              type="submit"
              disabled={isSubmitting}
              className="w-full h-[48px] md:h-[48px] rounded-xl text-[15px]"
            >
              {isSubmitting ? <Loader2 className="animate-spin motion-reduce:animate-none" aria-label="Signing in" /> : 'Sign In'}
            </Button>
          </form>

          {/* Divider */}
          <div className="mt-8 text-center text-muted-foreground text-[13px]">
            Or continue with
          </div>

          {/* OneLogin */}
          <Button
            variant="outline"
            className="w-full h-[48px] md:h-[48px] mt-4 rounded-xl text-[15px]"
          >
            Login with OneLogin
          </Button>

          <footer className="mt-12 text-center text-[11px] text-muted-foreground">
            © 2026 Shiftopia Labor Management
          </footer>
        </div>
      </motion.div>
    </div>
  );
};

export default LoginPage;
