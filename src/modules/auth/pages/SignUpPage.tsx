// src/modules/auth/pages/SignUpPage.tsx

import { PageState } from '@/modules/core/ui/components/PageState';
import React, { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useToast } from '@/modules/core/hooks/use-toast';
import { useAuth } from '@/platform/auth/useAuth';
import { supabase } from '@/platform/supabase/client';
import {
    Loader2, AlertCircle,
    CheckCircle2, ShieldCheck, Eye, EyeOff
} from 'lucide-react';
import { Button } from '@/modules/core/ui/primitives/button';
import { Input } from '@/modules/core/ui/primitives/input';

const SignUpPage: React.FC = () => {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [firstName, setFirstName] = useState('');
    const [lastName, setLastName] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [signUpError, setSignUpError] = useState<string | null>(null);
    const [isSuccess, setIsSuccess] = useState(false);

    const navigate = useNavigate();
    const { toast } = useToast();
    const { isAuthenticated, isLoading, getLandingPage } = useAuth();

    useEffect(() => {
        if (isAuthenticated && !isLoading) {
            navigate(getLandingPage(), { replace: true });
        }
    }, [isAuthenticated, isLoading, navigate, getLandingPage]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        if (!email.trim() || !password || !confirmPassword || !firstName.trim() || !lastName.trim()) {
            setSignUpError('Please fill in all required fields');
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
            const { data, error } = await supabase.auth.signUp({
                email: email.trim(),
                password,
                options: {
                    data: {
                        first_name: firstName.trim(),
                        last_name: lastName.trim(),
                    },
                },
            });

            if (error) throw error;

            if (data.user) {
                setIsSuccess(true);
                toast({
                    title: 'Account Created!',
                    description: 'Please check your email to verify your account.',
                });
                if (data.session) navigate('/pending-access', { replace: true });
            }
        } catch (err: any) {
            setSignUpError(err.message || 'Registration failed');
        } finally {
            setIsSubmitting(false);
        }
    };

    if (isLoading) {
        return (
            <div className="min-h-screen bg-background">
                <PageState state="loading" scope="page" title="Loading" />
            </div>
        );
    }

    if (isSuccess) {
        return (
            <div className="min-h-screen w-full flex items-center justify-center p-6 bg-background">
                <motion.div
                    initial={{ opacity: 0, scale: 0.96 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="w-full max-w-md p-8 rounded-2xl bg-card border border-border/60 shadow-sm text-center"
                    role="status"
                >
                    <div className="mx-auto mb-6 w-16 h-16 rounded-full bg-emerald-500/10 flex items-center justify-center border border-emerald-500/20">
                        <CheckCircle2 className="w-8 h-8 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
                    </div>
                    <h2 className="text-[24px] font-bold text-foreground mb-3">Verification sent</h2>
                    <p className="text-[14px] text-muted-foreground mb-8">
                        We&apos;ve sent a link to <strong className="text-foreground">{email}</strong>.
                    </p>
                    <Button asChild className="w-full h-[48px] md:h-[48px] rounded-xl text-[15px]">
                        <Link to="/login">Return to Sign In</Link>
                    </Button>
                </motion.div>
            </div>
        );
    }

    const field = 'h-[48px] md:h-[48px] rounded-xl';
    const label = 'text-[13px] font-medium text-foreground';

    return (
        <div className="min-h-screen w-full flex flex-col md:flex-row bg-background font-sans">

            {/* LEFT SIDE — white text stays: it sits on a dark photo overlay in both themes */}
            <motion.div
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.8 }}
                className="hidden md:flex md:w-1/2 relative overflow-hidden md:rounded-l-2xl"
            >
                <img
                    src="/auth-bg.jpeg"
                    alt=""
                    className="absolute inset-0 w-full h-full object-cover scale-105"
                />

                {/* gradient */}
                <div className="absolute inset-0 bg-gradient-to-t from-[#0f1113]/80 via-transparent to-transparent" />

                {/* inner shadow */}
                <div className="absolute inset-0 shadow-[inset_0_0_120px_rgba(0,0,0,0.6)]" />

                {/* content */}
                <div className="absolute bottom-12 left-12 z-10">
                    <div className="flex items-center gap-2 mb-4">
                        <div className="w-8 h-8 rounded-lg bg-white/10 flex items-center justify-center border border-white/20">
                            <ShieldCheck className="w-5 h-5 text-purple-300" aria-hidden="true" />
                        </div>
                        <span className="text-white/80 text-[11px] uppercase tracking-wider">Premium Experience</span>
                    </div>

                    <h2 className="text-[36px] font-bold text-white mb-2 leading-tight">
                        Elevate your team <br /> management game.
                    </h2>

                    <p className="text-white/75 text-[17px] max-w-md">
                        Join organizations optimizing their workforce.
                    </p>
                </div>
            </motion.div>

            {/* RIGHT SIDE */}
            <motion.div
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.8 }}
                className="flex-1 flex items-center justify-center p-6 md:p-12 bg-background"
            >
                <div className="w-full max-w-md">

                    <h1 className="text-[28px] font-bold text-foreground mb-3">Create an account</h1>

                    <p className="text-[14px] text-muted-foreground mb-6">
                        Already have an account?{' '}
                        <Link to="/login" className="font-medium text-primary hover:text-primary/80 underline underline-offset-4">Log in</Link>
                    </p>

                    <AnimatePresence>
                        {signUpError && (
                            <motion.div
                                role="alert"
                                className="mb-4 p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-700 dark:text-red-400 text-[13px] flex gap-2"
                            >
                                <AlertCircle className="w-5 h-5 shrink-0" aria-hidden="true" />
                                {signUpError}
                            </motion.div>
                        )}
                    </AnimatePresence>

                    {/* Visible labels — placeholders vanish as you type, so they cannot be the label. */}
                    <form onSubmit={handleSubmit} className="space-y-4">

                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <label htmlFor="signup-first" className={label}>First name</label>
                                <Input id="signup-first" autoComplete="given-name" value={firstName} onChange={e => setFirstName(e.target.value)} className={field} />
                            </div>
                            <div className="space-y-2">
                                <label htmlFor="signup-last" className={label}>Last name</label>
                                <Input id="signup-last" autoComplete="family-name" value={lastName} onChange={e => setLastName(e.target.value)} className={field} />
                            </div>
                        </div>

                        <div className="space-y-2">
                            <label htmlFor="signup-email" className={label}>Email</label>
                            <Input id="signup-email" type="email" inputMode="email" autoComplete="email" placeholder="name@company.com" value={email} onChange={e => setEmail(e.target.value)} className={field} />
                        </div>

                        <div className="space-y-2">
                            <label htmlFor="signup-password" className={label}>Password</label>
                            <div className="relative">
                                <Input
                                    id="signup-password"
                                    type={showPassword ? "text" : "password"}
                                    autoComplete="new-password"
                                    value={password}
                                    onChange={e => setPassword(e.target.value)}
                                    className={`${field} pr-14`}
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

                        <div className="space-y-2">
                            <label htmlFor="signup-confirm" className={label}>Confirm password</label>
                            <Input
                                id="signup-confirm"
                                type={showPassword ? "text" : "password"}
                                autoComplete="new-password"
                                value={confirmPassword}
                                onChange={e => setConfirmPassword(e.target.value)}
                                className={field}
                            />
                        </div>

                        <Button type="submit" disabled={isSubmitting} className="w-full h-[48px] md:h-[48px] rounded-xl text-[15px]">
                            {isSubmitting ? <Loader2 className="animate-spin motion-reduce:animate-none" aria-label="Creating account" /> : 'Create account'}
                        </Button>

                    </form>
                </div>
            </motion.div>
        </div>
    );
};

export default SignUpPage;