// src/modules/auth/pages/SignUpPage.tsx
// Registration Page for new users

import React, { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useToast } from '@/modules/core/hooks/use-toast';
import { useAuth } from '@/platform/auth/useAuth';
import { supabase } from '@/platform/realtime/client';
import { Mail, Lock, User, Loader2, AlertCircle, CheckCircle2 } from 'lucide-react';
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
   SIGN UP PAGE COMPONENT
   ============================================================ */
const SignUpPage: React.FC = () => {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [firstName, setFirstName] = useState('');
    const [lastName, setLastName] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [signUpError, setSignUpError] = useState<string | null>(null);
    const [isSuccess, setIsSuccess] = useState(false);

    const navigate = useNavigate();
    const { toast } = useToast();
    const { isAuthenticated, isLoading } = useAuth();

    // Redirect if already authenticated
    useEffect(() => {
        if (isAuthenticated && !isLoading) {
            navigate('/dashboard', { replace: true });
        }
    }, [isAuthenticated, isLoading, navigate]);

    // Handle form submission
    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        // Validation
        if (!email.trim() || !password || !confirmPassword || !firstName.trim() || !lastName.trim()) {
            setSignUpError('Please fill in all required fields (Name, Email, Password)');
            return;
        }

        if (password !== confirmPassword) {
            setSignUpError('Passwords do not match');
            return;
        }

        if (password.length < 6) {
            setSignUpError('Password must be at least 6 characters');
            return;
        }

        setIsSubmitting(true);
        setSignUpError(null);

        try {
            console.log('[SignUp] Submitting registration for:', email);

            const { data, error } = await supabase.auth.signUp({
                email: email.trim(),
                password,
                options: {
                    data: {
                        first_name: firstName.trim() || 'User',
                        last_name: lastName.trim() || '',
                    },
                },
            });

            if (error) {
                throw error;
            }

            if (data.user) {
                setIsSuccess(true);
                toast({
                    title: 'Account Created!',
                    description: 'Please check your email to verify your account.',
                });

                // If email confirmation is disabled, redirect to pending-access
                if (data.session) {
                    navigate('/pending-access', { replace: true });
                }
            }
        } catch (err: any) {
            console.error('[SignUp] Registration failed:', err);

            const errorMessage = err.message || 'Registration failed. Please try again.';
            setSignUpError(errorMessage);

            toast({
                title: 'Registration Failed',
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

    // Success state
    if (isSuccess) {
        return (
            <div className="min-h-screen w-full flex items-center justify-center p-4 relative overflow-hidden bg-background">
                <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_var(--tw-gradient-stops))] from-primary/20 via-background to-background pointer-events-none" />

                <motion.div
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="w-full max-w-sm relative z-10"
                >
                    <div className="rounded-2xl p-8 md:p-10 shadow-2xl bg-card/40 backdrop-blur-xl border border-white/10 text-center">
                        <motion.div
                            initial={{ scale: 0 }}
                            animate={{ scale: 1 }}
                            transition={{ delay: 0.2, type: 'spring' }}
                            className="mx-auto mb-6 w-16 h-16 rounded-full bg-emerald-500/20 flex items-center justify-center"
                        >
                            <CheckCircle2 className="w-8 h-8 text-emerald-400" />
                        </motion.div>

                        <h2 className="text-2xl font-bold text-foreground mb-2">Check Your Email</h2>
                        <p className="text-muted-foreground text-sm mb-6">
                            We've sent a verification link to <strong>{email}</strong>.
                            Click the link to activate your account.
                        </p>

                        <Link to="/login">
                            <Button variant="outline" className="w-full">
                                Back to Login
                            </Button>
                        </Link>
                    </div>
                </motion.div>
            </div>
        );
    }

    return (
        <div className="min-h-screen w-full flex items-center justify-center p-4 relative overflow-hidden bg-background">
            {/* Background Ambience */}
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_var(--tw-gradient-stops))] from-primary/20 via-background to-background pointer-events-none" />
            <div className="absolute top-0 left-0 w-full h-full bg-[url('https://grainy-gradients.vercel.app/noise.svg')] opacity-20 pointer-events-none mix-blend-soft-light" />
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

                        <h1 className="text-3xl font-bold text-foreground mb-2 tracking-tight">Create Account</h1>
                        <p className="text-muted-foreground text-sm">
                            Join your team and start managing shifts.
                        </p>
                    </header>

                    {/* Error Display */}
                    {signUpError && (
                        <motion.div
                            initial={{ opacity: 0, height: 0 }}
                            animate={{ opacity: 1, height: 'auto' }}
                            className="mb-6 p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-sm flex items-center gap-2"
                        >
                            <AlertCircle className="h-4 w-4 shrink-0" />
                            <p>{signUpError}</p>
                        </motion.div>
                    )}

                    {/* Registration Form */}
                    <form onSubmit={handleSubmit} className="space-y-4">
                        <div className="grid grid-cols-2 gap-3">
                            <div className="relative">
                                <User className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                                <Input
                                    type="text"
                                    placeholder="First Name"
                                    value={firstName}
                                    onChange={(e) => setFirstName(e.target.value)}
                                    className="pl-9 h-11 bg-black/20 border-white/10 focus:bg-black/40 transition-colors"
                                    disabled={isSubmitting}
                                />
                            </div>
                            <Input
                                type="text"
                                placeholder="Last Name"
                                value={lastName}
                                onChange={(e) => setLastName(e.target.value)}
                                className="h-11 bg-black/20 border-white/10 focus:bg-black/40 transition-colors"
                                disabled={isSubmitting}
                            />
                        </div>

                        <div className="relative">
                            <Mail className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                            <Input
                                type="email"
                                placeholder="Email Address"
                                value={email}
                                onChange={(e) => {
                                    setEmail(e.target.value);
                                    setSignUpError(null);
                                }}
                                className="pl-9 h-11 bg-black/20 border-white/10 focus:bg-black/40 transition-colors"
                                required
                                disabled={isSubmitting}
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
                                    setSignUpError(null);
                                }}
                                className="pl-9 h-11 bg-black/20 border-white/10 focus:bg-black/40 transition-colors"
                                required
                                disabled={isSubmitting}
                            />
                        </div>

                        <div className="relative">
                            <Lock className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                            <Input
                                type="password"
                                placeholder="Confirm Password"
                                value={confirmPassword}
                                onChange={(e) => {
                                    setConfirmPassword(e.target.value);
                                    setSignUpError(null);
                                }}
                                className="pl-9 h-11 bg-black/20 border-white/10 focus:bg-black/40 transition-colors"
                                required
                                disabled={isSubmitting}
                            />
                        </div>

                        <Button
                            type="submit"
                            disabled={isSubmitting || !email.trim() || !password || !confirmPassword}
                            className="w-full h-11 text-base shadow-glow hover:shadow-glow/50 transition-all duration-300"
                            size="lg"
                        >
                            {isSubmitting ? (
                                <>
                                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                    Creating Account...
                                </>
                            ) : (
                                'Sign Up'
                            )}
                        </Button>
                    </form>

                    {/* Footer */}
                    <div className="mt-6 text-center text-sm text-muted-foreground">
                        <p>
                            Already have an account?{' '}
                            <Link to="/login" className="text-primary hover:underline font-medium">
                                Sign In
                            </Link>
                        </p>
                    </div>
                </div>
            </motion.div>
        </div>
    );
};

export default SignUpPage;
