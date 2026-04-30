// src/pages/LoginPage.tsx
// FIXED VERSION - Better error handling and loading states

import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useToast } from '@/modules/core/hooks/use-toast';
import { useAuth } from '@/platform/auth/useAuth';
import { Mail, Lock, Loader2, AlertCircle } from 'lucide-react';
import { cn } from '@/modules/core/lib/utils';
import { Button } from '@/modules/core/ui/primitives/button';
import { Input } from '@/modules/core/ui/primitives/input';

/* ============================================================
   SHIFTOPIA LOGO COMPONENT
   ============================================================ */
const ShiftopiaLogo: React.FC<{ className?: string }> = ({ className }) => (
  <svg
    width="48"
    height="48"
    viewBox="0 0 24 24"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    className={className}
  >
    <path
      d="M12.381 3.99998C12.381 3.99998 12.381 12.023 12.381 12.023C12.381 12.023 20.355 12.023 20.355 12.023C20.355 12.023 12.381 20.046 12.381 20.046C12.381 20.046 12.381 12.023 12.381 12.023C12.381 12.023 4.40698 12.023 4.40698 12.023C4.40698 12.023 12.381 3.99998 12.381 3.99998Z"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

/* ============================================================
   LOGIN PAGE COMPONENT
   ============================================================ */
const LoginPage: React.FC = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);

  const navigate = useNavigate();
  const location = useLocation();
  const { toast } = useToast();
  const { login, isAuthenticated, isLoading, error: authError } = useAuth();

  // Redirect if already authenticated
  useEffect(() => {
    if (isAuthenticated && !isLoading) {
      const from = (location.state as any)?.from?.pathname || '/my-roster';
      console.log('[Login] Already authenticated, redirecting to:', from);
      navigate(from, { replace: true });
    }
  }, [isAuthenticated, isLoading, navigate, location]);

  // Handle form submission
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!email.trim() || !password) {
      setLoginError('Please enter both email and password');
      return;
    }

    setIsSubmitting(true);
    setLoginError(null);

    try {
      console.log('[Login] Submitting login for:', email);
      await login(email.trim(), password);

      toast({
        title: 'Welcome back!',
        description: 'Login successful.',
      });

      const from = (location.state as any)?.from?.pathname || '/my-roster';
      navigate(from, { replace: true });
    } catch (err: any) {
      console.error('[Login] Login failed:', err);

      const errorMessage = err.message || 'Login failed. Please try again.';
      setLoginError(errorMessage);

      toast({
        title: 'Login Failed',
        description: errorMessage,
        variant: 'destructive',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  // Show loading while checking auth state
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="h-10 w-10 text-primary animate-spin" />
          <p className="text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen w-full flex items-center justify-center p-4 relative overflow-hidden bg-background">
      {/* Background Ambience */}
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_var(--tw-gradient-stops))] from-primary/20 via-background to-background pointer-events-none" />
      <div className="absolute top-0 left-0 w-full h-full bg-[url('data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyMDAgMjAwIj48ZmlsdGVyIGlkPSJuIj48ZmVUdXJidWxlbmNlIHR5cGU9ImZyYWN0YWxOb2lzZSIgYmFzZUZyZXF1ZW5jeT0iMC42NSIgbnVtT2N0YXZlcz0iMyIgc3RpdGNoVGlsZXM9InN0aXRjaCIvPjwvZmlsdGVyPjxyZWN0IHdpZHRoPSIxMDAlIiBoZWlnaHQ9IjEwMCUiIGZpbHRlcj0idXJsKCNuKSIvPjwvc3ZnPg==')] opacity-20 pointer-events-none mix-blend-soft-light" />
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-primary/20 rounded-full blur-[100px] pointer-events-none" />

      <motion.div
        initial={{ opacity: 0, y: 20, scale: 0.95 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.5, ease: 'easeOut' }}
        className="w-full max-w-sm relative z-10"
      >
        <div
          className={cn(
            'rounded-2xl p-8 md:p-10 shadow-2xl',
            'bg-card/40 backdrop-blur-xl',
            'border border-white/10'
          )}
        >
          {/* Header */}
          <header className="text-center mb-8">
            <motion.div
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ delay: 0.2 }}
              className="flex justify-center items-center gap-3 mb-6"
            >
              <div className="p-3 rounded-xl bg-primary/20 ring-1 ring-primary/50 shadow-glow">
                <ShiftopiaLogo className="text-primary-foreground" />
              </div>
            </motion.div>

            <h1 className="text-3xl font-bold text-foreground mb-2 tracking-tight">Welcome Back</h1>
            <p className="text-muted-foreground text-sm">
              Enter your credentials to access the platform.
            </p>
          </header>

          {/* Error Display */}
          {(loginError || authError) && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              className="mb-6 p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-sm flex items-center gap-2"
            >
              <AlertCircle className="h-4 w-4 shrink-0" />
              <p>{loginError || authError}</p>
            </motion.div>
          )}

          {/* Login Form */}
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <div className="relative">
                <Mail className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                <Input
                  type="email"
                  placeholder="Email Address"
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    setLoginError(null);
                  }}
                  className="pl-9 h-11 bg-black/20 border-white/10 focus:bg-black/40 transition-colors"
                  required
                  disabled={isSubmitting}
                  autoFocus
                />
              </div>
              <div className="relative">
                <Lock className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                <Input
                  type="password"
                  placeholder="Password"
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    setLoginError(null);
                  }}
                  className="pl-9 h-11 bg-black/20 border-white/10 focus:bg-black/40 transition-colors"
                  required
                  disabled={isSubmitting}
                />
              </div>
            </div>

            <Button
              type="submit"
              disabled={isSubmitting || !email.trim() || !password}
              className="w-full h-11 text-base shadow-glow hover:shadow-glow/50 transition-all duration-300"
              size="lg"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Signing In...
                </>
              ) : (
                'Sign In'
              )}
            </Button>
          </form>

          {/* Footer */}
          <div className="mt-6 text-center text-sm text-muted-foreground">
            <p>
              Don't have an account?{' '}
              <Link to="/signup" className="text-primary hover:underline font-medium">
                Sign Up
              </Link>
            </p>
          </div>
          <div className="mt-4 text-center text-xs text-muted-foreground/60">
            <p>Protected by enterprise-grade security.</p>
          </div>
        </div>
      </motion.div>
    </div>
  );
};

export default LoginPage;
