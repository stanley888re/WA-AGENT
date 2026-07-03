import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  ShieldCheck, Users, Bot, MessageSquare, ShoppingBag, BarChart3,
  Trash2, Crown, UserX, Loader2, ShieldBan, Phone, PhoneOff,
  Zap, ZapOff, Info, Settings, Globe, Mail, Key, Activity,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/context/AuthContext";
import { Redirect } from "wouter";

type AdminUser = { id: number; name: string; email: string; role: string; createdAt: string };
type AdminStats = { users: number; agents: number; conversations: number; messages: number; leads: number; orders: number };
type AdminAgent = {
  id: number; name: string; model: string; isActive: boolean;
  whatsappConnected: boolean; whatsappPhone?: string | null;
  createdAt: string; userName?: string | null; userEmail?: string | null;
};

function useAdminUsers() {
  return useQuery<AdminUser[]>({
    queryKey: ["admin-users"],
    queryFn: async () => {
      const r = await fetch("/api/admin/users", { credentials: "include" });
      if (!r.ok) throw new Error("Erreur");
      return r.json();
    },
  });
}

function useAdminStats() {
  return useQuery<AdminStats>({
    queryKey: ["admin-stats"],
    queryFn: async () => {
      const r = await fetch("/api/admin/stats", { credentials: "include" });
      if (!r.ok) throw new Error("Erreur");
      return r.json();
    },
  });
}

function useAdminAgents() {
  return useQuery<AdminAgent[]>({
    queryKey: ["admin-agents"],
    queryFn: async () => {
      const r = await fetch("/api/admin/agents", { credentials: "include" });
      if (!r.ok) throw new Error("Erreur");
      return r.json();
    },
  });
}

export default function Admin() {
  const { user } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();

  const [confirmDelete, setConfirmDelete] = useState<AdminUser | null>(null);

  const { data: users = [], isLoading: loadingUsers } = useAdminUsers();
  const { data: stats } = useAdminStats();
  const { data: agents = [], isLoading: loadingAgents } = useAdminAgents();

  if (user && user.role !== "admin") return <Redirect to="/" />;

  const roleMutation = useMutation({
    mutationFn: async ({ id, role }: { id: number; role: string }) => {
      const r = await fetch(`/api/admin/users/${id}/role`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ role }),
      });
      if (!r.ok) throw new Error("Erreur");
      return r.json();
    },
    onSuccess: (_, { role }) => {
      qc.invalidateQueries({ queryKey: ["admin-users"] });
      toast({ title: role === "admin" ? "Administrateur promu" : "Droits admin révoqués" });
    },
    onError: () => toast({ title: "Erreur", variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      const r = await fetch(`/api/admin/users/${id}`, { method: "DELETE", credentials: "include" });
      if (!r.ok) throw new Error("Erreur");
      return r.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-users"] });
      toast({ title: "Compte supprimé" });
      setConfirmDelete(null);
    },
    onError: () => toast({ title: "Erreur lors de la suppression", variant: "destructive" }),
  });

  const statCards = [
    { label: "Utilisateurs", value: stats?.users ?? "—", icon: Users, color: "text-blue-500", bg: "bg-blue-50" },
    { label: "Agents IA", value: stats?.agents ?? "—", icon: Bot, color: "text-green-500", bg: "bg-green-50" },
    { label: "Conversations", value: stats?.conversations ?? "—", icon: MessageSquare, color: "text-purple-500", bg: "bg-purple-50" },
    { label: "Messages", value: stats?.messages ?? "—", icon: BarChart3, color: "text-orange-500", bg: "bg-orange-50" },
    { label: "Leads", value: stats?.leads ?? "—", icon: Users, color: "text-pink-500", bg: "bg-pink-50" },
    { label: "Commandes", value: stats?.orders ?? "—", icon: ShoppingBag, color: "text-yellow-600", bg: "bg-yellow-50" },
  ];

  const connectedAgents = agents.filter(a => a.whatsappConnected).length;
  const activeAgents = agents.filter(a => a.isActive).length;

  return (
    <div className="p-3 md:p-8 max-w-6xl mx-auto flex flex-col gap-4 md:gap-6">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="w-9 h-9 md:w-10 md:h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
          <ShieldCheck className="w-4 h-4 md:w-5 md:h-5 text-primary" />
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="text-lg md:text-3xl font-bold tracking-tight">Panneau Administrateur</h1>
          <p className="text-muted-foreground mt-0.5 text-xs md:text-sm">Gestion complète de la plateforme WA Agent.</p>
        </div>
        <Badge className="bg-primary/10 text-primary border-primary/20 border shrink-0 text-xs">
          <Crown className="w-3 h-3 mr-1" />
          <span className="hidden sm:inline">Admin : </span>{user?.email}
        </Badge>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 sm:grid-cols-3 lg:grid-cols-6 gap-2 md:gap-4">
        {statCards.map(s => (
          <Card key={s.label}>
            <CardContent className="pt-3 pb-2 md:pt-4 md:pb-3 text-center px-2">
              <div className={`w-7 h-7 md:w-8 md:h-8 rounded-lg ${s.bg} flex items-center justify-center mx-auto mb-1.5`}>
                <s.icon className={`w-3.5 h-3.5 md:w-4 md:h-4 ${s.color}`} />
              </div>
              <p className="text-xl md:text-2xl font-bold">{s.value}</p>
              <p className="text-[10px] md:text-xs text-muted-foreground mt-0.5 leading-tight">{s.label}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Tabs */}
      <Tabs defaultValue="users">
        <TabsList className="grid w-full grid-cols-3 h-auto">
          <TabsTrigger value="users" className="text-xs md:text-sm gap-1.5">
            <Users className="w-3.5 h-3.5" />
            <span>Utilisateurs</span>
          </TabsTrigger>
          <TabsTrigger value="agents" className="text-xs md:text-sm gap-1.5">
            <Bot className="w-3.5 h-3.5" />
            <span>Agents</span>
          </TabsTrigger>
          <TabsTrigger value="system" className="text-xs md:text-sm gap-1.5">
            <Settings className="w-3.5 h-3.5" />
            <span>Système</span>
          </TabsTrigger>
        </TabsList>

        {/* ── USERS TAB ── */}
        <TabsContent value="users" className="mt-4">
          <Card>
            <CardHeader className="pb-3 px-4 md:px-6">
              <CardTitle className="flex items-center gap-2 text-sm md:text-base">
                <Users className="w-4 h-4" /> Gestion des utilisateurs
                <Badge variant="secondary" className="ml-auto text-xs">{users.length}</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="pl-4 md:pl-6">Nom</TableHead>
                      <TableHead className="hidden sm:table-cell">Email</TableHead>
                      <TableHead>Rôle</TableHead>
                      <TableHead className="hidden md:table-cell">Inscrit le</TableHead>
                      <TableHead className="text-right pr-4 md:pr-6">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {loadingUsers ? (
                      [1, 2, 3].map(i => (
                        <TableRow key={i}>
                          {[1, 2, 3, 4, 5].map(j => (
                            <TableCell key={j}><div className="h-4 bg-muted rounded animate-pulse w-20" /></TableCell>
                          ))}
                        </TableRow>
                      ))
                    ) : users.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={5} className="text-center py-10 text-muted-foreground text-sm">
                          Aucun utilisateur trouvé.
                        </TableCell>
                      </TableRow>
                    ) : users.map(u => (
                      <TableRow key={u.id}>
                        <TableCell className="pl-4 md:pl-6">
                          <div className="flex items-center gap-2">
                            <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center shrink-0 hidden sm:flex">
                              <span className="text-xs font-semibold text-primary">{u.name.charAt(0).toUpperCase()}</span>
                            </div>
                            <div className="min-w-0">
                              <div className="font-medium text-sm truncate max-w-[120px] md:max-w-none">{u.name}</div>
                              <div className="text-xs text-muted-foreground sm:hidden truncate max-w-[120px]">{u.email}</div>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="hidden sm:table-cell text-muted-foreground text-sm">{u.email}</TableCell>
                        <TableCell>
                          {u.role === "admin" ? (
                            <Badge className="bg-amber-100 text-amber-700 border-amber-200 border gap-1 text-[10px] md:text-xs">
                              <Crown className="w-2.5 h-2.5" />Admin
                            </Badge>
                          ) : (
                            <Badge variant="secondary" className="text-[10px] md:text-xs">User</Badge>
                          )}
                        </TableCell>
                        <TableCell className="hidden md:table-cell text-muted-foreground text-sm">
                          {new Date(u.createdAt).toLocaleDateString("fr-FR")}
                        </TableCell>
                        <TableCell className="text-right pr-4 md:pr-6">
                          <div className="flex items-center justify-end gap-1 md:gap-2">
                            {u.id !== user?.id && (
                              <>
                                {u.role !== "admin" ? (
                                  <Button size="sm" variant="outline"
                                    className="gap-1 h-7 text-[10px] md:text-xs px-2"
                                    onClick={() => roleMutation.mutate({ id: u.id, role: "admin" })}
                                    disabled={roleMutation.isPending}>
                                    <Crown className="w-3 h-3" />
                                    <span className="hidden md:inline">Promouvoir</span>
                                  </Button>
                                ) : (
                                  <Button size="sm" variant="outline"
                                    className="gap-1 h-7 text-[10px] md:text-xs px-2 text-muted-foreground"
                                    onClick={() => roleMutation.mutate({ id: u.id, role: "user" })}
                                    disabled={roleMutation.isPending}>
                                    <ShieldBan className="w-3 h-3" />
                                    <span className="hidden md:inline">Révoquer</span>
                                  </Button>
                                )}
                                <Button size="icon" variant="ghost"
                                  className="h-7 w-7 text-destructive hover:bg-destructive/10"
                                  onClick={() => setConfirmDelete(u)}>
                                  <Trash2 className="w-3.5 h-3.5" />
                                </Button>
                              </>
                            )}
                            {u.id === user?.id && (
                              <Badge variant="outline" className="text-[10px] text-muted-foreground">Vous</Badge>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── AGENTS TAB ── */}
        <TabsContent value="agents" className="mt-4 space-y-4">
          {/* Quick stats */}
          <div className="grid grid-cols-3 gap-3">
            <Card>
              <CardContent className="pt-4 pb-3 text-center">
                <p className="text-2xl font-bold text-green-600">{connectedAgents}</p>
                <p className="text-xs text-muted-foreground mt-0.5">WhatsApp connectés</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4 pb-3 text-center">
                <p className="text-2xl font-bold text-violet-600">{activeAgents}</p>
                <p className="text-xs text-muted-foreground mt-0.5">Agents actifs</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4 pb-3 text-center">
                <p className="text-2xl font-bold">{agents.length}</p>
                <p className="text-xs text-muted-foreground mt-0.5">Total agents</p>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader className="pb-3 px-4 md:px-6">
              <CardTitle className="flex items-center gap-2 text-sm md:text-base">
                <Bot className="w-4 h-4 text-violet-500" /> Tous les agents de la plateforme
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="pl-4 md:pl-6">Agent</TableHead>
                      <TableHead className="hidden sm:table-cell">Propriétaire</TableHead>
                      <TableHead>Statut</TableHead>
                      <TableHead className="hidden md:table-cell">WhatsApp</TableHead>
                      <TableHead className="hidden lg:table-cell">Modèle</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {loadingAgents ? (
                      [1, 2, 3].map(i => (
                        <TableRow key={i}>
                          {[1, 2, 3, 4].map(j => (
                            <TableCell key={j}><div className="h-4 bg-muted rounded animate-pulse w-24" /></TableCell>
                          ))}
                        </TableRow>
                      ))
                    ) : agents.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={5} className="text-center py-10 text-muted-foreground text-sm">
                          Aucun agent sur la plateforme.
                        </TableCell>
                      </TableRow>
                    ) : agents.map(ag => (
                      <TableRow key={ag.id}>
                        <TableCell className="pl-4 md:pl-6">
                          <div className="flex items-center gap-2">
                            <div className="w-7 h-7 rounded-lg bg-violet-100 flex items-center justify-center shrink-0">
                              <Bot className="w-3.5 h-3.5 text-violet-600" />
                            </div>
                            <div className="min-w-0">
                              <div className="font-medium text-sm truncate max-w-[100px] md:max-w-[200px]">{ag.name}</div>
                              <div className="text-xs text-muted-foreground sm:hidden">{ag.userEmail}</div>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="hidden sm:table-cell text-sm text-muted-foreground">
                          <div>{ag.userName}</div>
                          <div className="text-xs hidden md:block">{ag.userEmail}</div>
                        </TableCell>
                        <TableCell>
                          {ag.isActive ? (
                            <Badge className="bg-emerald-100 text-emerald-700 border-0 text-[10px] gap-1">
                              <Zap className="w-2.5 h-2.5" />Actif
                            </Badge>
                          ) : (
                            <Badge variant="secondary" className="text-[10px] gap-1">
                              <ZapOff className="w-2.5 h-2.5" />Inactif
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="hidden md:table-cell">
                          {ag.whatsappConnected ? (
                            <div className="flex items-center gap-1.5 text-xs text-green-700">
                              <Phone className="w-3 h-3" />
                              <span>{ag.whatsappPhone ? `+${ag.whatsappPhone}` : "Connecté"}</span>
                            </div>
                          ) : (
                            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                              <PhoneOff className="w-3 h-3" />Non connecté
                            </div>
                          )}
                        </TableCell>
                        <TableCell className="hidden lg:table-cell text-xs text-muted-foreground">{ag.model}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── SYSTEM TAB ── */}
        <TabsContent value="system" className="mt-4 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* System Info */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-sm md:text-base">
                  <Info className="w-4 h-4 text-blue-500" /> Informations système
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {[
                  { label: "Environnement", value: "Production / Render", icon: Globe },
                  { label: "Runtime", value: "Node.js 20 + Express 5", icon: Activity },
                  { label: "Base de données", value: "PostgreSQL (Supabase)", icon: Settings },
                  { label: "IA WhatsApp", value: "Baileys (Multi-device)", icon: Bot },
                  { label: "Stockage images", value: "Cloudinary", icon: Settings },
                  { label: "Sessions", value: "PostgreSQL (connect-pg-simple)", icon: Key },
                ].map(item => (
                  <div key={item.label} className="flex items-center justify-between text-sm gap-2">
                    <div className="flex items-center gap-2 text-muted-foreground min-w-0">
                      <item.icon className="w-3.5 h-3.5 shrink-0" />
                      <span className="truncate">{item.label}</span>
                    </div>
                    <span className="font-medium text-right text-xs md:text-sm shrink-0">{item.value}</span>
                  </div>
                ))}
              </CardContent>
            </Card>

            {/* Configuration requise */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-sm md:text-base">
                  <Settings className="w-4 h-4 text-orange-500" /> Variables d'environnement
                </CardTitle>
                <CardDescription className="text-xs">Vérifiez que toutes les variables sont configurées sur Render.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                {[
                  { key: "DATABASE_URL / SUPABASE_DATABASE_URL", required: true, desc: "Connexion PostgreSQL" },
                  { key: "SESSION_SECRET", required: true, desc: "Sécurité des sessions" },
                  { key: "CLOUDINARY_*", required: true, desc: "Upload d'images produits" },
                  { key: "AI_API_URL", required: true, desc: "API IA pour les agents" },
                  { key: "ADMIN_EMAILS", required: false, desc: "Emails administrateurs (virgule)" },
                  { key: "ALLOWED_ORIGINS", required: false, desc: "Domaines CORS autorisés (prod)" },
                ].map(v => (
                  <div key={v.key} className="flex items-start gap-2 py-1.5 border-b last:border-0">
                    <code className="text-[10px] md:text-xs font-mono bg-muted px-1.5 py-0.5 rounded shrink-0 mt-0.5">{v.key}</code>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-muted-foreground">{v.desc}</p>
                    </div>
                    <Badge variant={v.required ? "destructive" : "secondary"} className="text-[9px] shrink-0">
                      {v.required ? "Requis" : "Optionnel"}
                    </Badge>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>

          {/* Admin emails */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-sm md:text-base">
                <Mail className="w-4 h-4 text-violet-500" /> Administrateurs configurés
              </CardTitle>
              <CardDescription className="text-xs">
                Ces emails ont automatiquement le rôle "admin" à la connexion. Configuré via la variable ADMIN_EMAILS.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-2">
                {users.filter(u => u.role === "admin").map(u => (
                  <div key={u.id} className="flex items-center gap-1.5 bg-amber-50 border border-amber-200 rounded-lg px-3 py-1.5">
                    <Crown className="w-3 h-3 text-amber-600 shrink-0" />
                    <span className="text-xs font-medium text-amber-800">{u.email}</span>
                  </div>
                ))}
                {users.filter(u => u.role === "admin").length === 0 && (
                  <p className="text-sm text-muted-foreground">Aucun administrateur enregistré.</p>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Deployment guide */}
          <Card className="border-blue-100 bg-blue-50/30">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-sm md:text-base text-blue-800">
                <Globe className="w-4 h-4 text-blue-600" /> Guide déploiement Render
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-xs text-blue-900">
              <div className="space-y-1.5">
                <p className="font-semibold text-sm">Commandes à configurer sur Render :</p>
                <div className="bg-white/70 rounded-lg p-3 font-mono space-y-1">
                  <p className="text-blue-800"><span className="text-muted-foreground">Build :</span> bash scripts/render-build.sh</p>
                  <p className="text-blue-800"><span className="text-muted-foreground">Start :</span> node --enable-source-maps artifacts/api-server/dist/index.mjs</p>
                  <p className="text-blue-800"><span className="text-muted-foreground">Health :</span> /api/healthz</p>
                </div>
                <p className="text-muted-foreground">Le render.yaml à la racine du projet contient déjà toute la configuration.</p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Delete confirmation dialog */}
      <Dialog open={!!confirmDelete} onOpenChange={() => setConfirmDelete(null)}>
        <DialogContent className="w-[calc(100vw-2rem)] max-w-md rounded-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <UserX className="w-5 h-5" /> Supprimer le compte
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Voulez-vous vraiment supprimer le compte de <strong>{confirmDelete?.name}</strong> ({confirmDelete?.email}) ?
            Cette action est irréversible et supprimera tous ses agents et données.
          </p>
          <DialogFooter className="flex-col sm:flex-row gap-2">
            <Button variant="outline" onClick={() => setConfirmDelete(null)} className="w-full sm:w-auto">Annuler</Button>
            <Button variant="destructive"
              onClick={() => confirmDelete && deleteMutation.mutate(confirmDelete.id)}
              disabled={deleteMutation.isPending} className="gap-2 w-full sm:w-auto">
              {deleteMutation.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
              Supprimer définitivement
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
