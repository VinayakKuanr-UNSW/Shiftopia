import React from 'react';
import { motion } from 'framer-motion';
import { Clock, Shield, Mail, LogOut } from 'lucide-react';
import { Button } from '@/modules/core/ui/primitives/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/modules/core/ui/primitives/card';
import { useAuth } from '@/platform/auth/useAuth';
import { Navigate } from 'react-router-dom';

/**
 * PendingAccessPage
 * 
 * Displayed when a user has successfully authenticated but has no active contracts.
 * This is the "waiting room" until an admin assigns them a contract.
 */
const PendingAccessPage: React.FC = () => {
    const { user, logout, isLoading } = useAuth();

    if (!isLoading && !user) {
        return <Navigate to="/login" replace />;
    }

    return (
        <div className="min-h-screen bg-gradient-to-br from-[#0d1424] via-[#1a2744] to-[#0d1424] flex items-center justify-center p-4">
            <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5 }}
                className="w-full max-w-md"
            >
                <Card className="border border-white/10 bg-white/5 backdrop-blur-xl shadow-2xl">
                    <CardHeader className="text-center pb-2">
                        <motion.div
                            initial={{ scale: 0 }}
                            animate={{ scale: 1 }}
                            transition={{ delay: 0.2, type: 'spring', stiffness: 200 }}
                            className="mx-auto mb-4 w-20 h-20 rounded-full bg-amber-500/10 flex items-center justify-center"
                        >
                            <Clock className="w-10 h-10 text-amber-400" />
                        </motion.div>
                        <CardTitle className="text-2xl font-bold text-white">
                            Access Pending
                        </CardTitle>
                        <CardDescription className="text-blue-200/60 mt-2">
                            Your account is awaiting activation
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-6">
                        <div className="bg-white/5 rounded-lg p-4 border border-white/10">
                            <div className="flex items-start gap-3">
                                <Shield className="w-5 h-5 text-primary mt-0.5 flex-shrink-0" />
                                <div>
                                    <p className="text-white text-sm font-medium">
                                        No Active Contracts
                                    </p>
                                    <p className="text-blue-200/60 text-sm mt-1">
                                        An administrator needs to assign you a contract to grant access to the system.
                                    </p>
                                </div>
                            </div>
                        </div>

                        <div className="bg-white/5 rounded-lg p-4 border border-white/10">
                            <div className="flex items-start gap-3">
                                <Mail className="w-5 h-5 text-emerald-400 mt-0.5 flex-shrink-0" />
                                <div>
                                    <p className="text-white text-sm font-medium">
                                        What to do next?
                                    </p>
                                    <p className="text-blue-200/60 text-sm mt-1">
                                        Contact your manager or HR administrator to request access.
                                        They will assign you to a department and role.
                                    </p>
                                </div>
                            </div>
                        </div>

                        {user && (
                            <div className="text-center pt-2">
                                <p className="text-blue-200/40 text-xs mb-4">
                                    Logged in as: <span className="text-blue-200/60">{user.email}</span>
                                </p>
                            </div>
                        )}

                        <div className="flex flex-col gap-3">
                            <Button
                                onClick={() => window.location.reload()}
                                variant="default"
                                className="w-full bg-primary hover:bg-primary/90"
                            >
                                Check Again
                            </Button>
                            <Button
                                onClick={logout}
                                variant="ghost"
                                className="w-full text-white/60 hover:text-white hover:bg-white/10"
                            >
                                <LogOut className="w-4 h-4 mr-2" />
                                Sign Out
                            </Button>
                        </div>
                    </CardContent>
                </Card>

                <p className="text-center text-blue-200/40 text-xs mt-6">
                    Need help? Contact your system administrator.
                </p>
            </motion.div>
        </div>
    );
};

export default PendingAccessPage;
