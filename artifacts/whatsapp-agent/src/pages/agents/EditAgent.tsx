import { useState, useRef, useEffect } from "react";
import { useParams } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useGetAgent, useUpdateAgent, useTestAgent, getGetAgentQueryKey } from "@workspace/api-client-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Card, CardContent } from "@/components/ui/card";
import { Send, Bot, User, QrCode, CheckCircle2, XCircle, Loader2, ArrowRight, ArrowLeft, Smartphone, RefreshCw, Package, ImageIcon, Check, Hash, PowerOff, Trash2 } from "lucide-react";

const API = import.meta.env.VITE_API_URL ?? "http://localhost:8080";

type Product = { id: number; name: string; description?: string | null; category?: string | null; price: number; status: string; imageUrl?: string | null; link?: string | null };

function AgentProductsTab({ agentId }: { agentId: number }) {
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());

  const { data: allProducts, isLoading: loadingProducts } = useQuery<Product[]>({
    queryKey: ["products"],
    queryFn: async () => {
      const res = await fetch(`/api/products`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load products");
      return res.json();
    },
  });

  const { data: agentProducts, isLoading: loadingAgentProducts } = useQuery<Product[]>({
    queryKey: ["agent-products", agentId],
    queryFn: async () => {
      const res = await fetch(`/api/agents/${agentId}/products`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load agent products");
      return res.json();
    },
    enabled: !!agentId,
  });

  useEffect(() => {
    if (agentProducts) {
      setSelected(new Set(agentProducts.map(p => p.id)));
    }
  }, [agentProducts]);

  const toggle = (id: number) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch(`/api/agents/${agentId}/products`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ productIds: Array.from(selected) }),
      });
      if (!res.ok) throw new Error();
      toast({ title: "Produits de l'agent mis à jour" });
    } catch {
      toast({ title: "Erreur de sauvegarde", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const isLoading = loadingProducts || loadingAgentProducts;
  const products = (allProducts ?? []).filter(p => p.status !== "inactive");

  return (
    <div className="space-y-4 mt-5">
      <div>
        <p className="text-sm text-muted-foreground">
          Sélectionnez les produits ou services que cet agent peut présenter. L'IA recevra leur description, prix et informations.
          Seuls les éléments sélectionnés seront connus de cet agent.
        </p>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {[1,2,3,4].map(i => <Skeleton key={i} className="h-20 rounded-lg" />)}
        </div>
      ) : products.length === 0 ? (
        <div className="text-center py-10 text-muted-foreground border rounded-lg">
          <Package className="w-10 h-10 mx-auto mb-3 opacity-20" />
          <p className="text-sm">Aucun produit disponible. Ajoutez des produits dans la section Produits.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {products.map(product => {
            const isSelected = selected.has(product.id);
            return (
              <div
                key={product.id}
                onClick={() => toggle(product.id)}
                className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                  isSelected ? "border-primary bg-primary/5" : "border-border hover:border-primary/40 hover:bg-muted/30"
                }`}
              >
                {product.imageUrl ? (
                  <img src={product.imageUrl} alt={product.name} className="w-12 h-12 rounded-md object-cover border shrink-0"
                    onError={e => { (e.target as HTMLImageElement).style.display = "none"; }} />
                ) : (
                  <div className="w-12 h-12 rounded-md bg-muted flex items-center justify-center shrink-0">
                    <ImageIcon className="w-5 h-5 text-muted-foreground" />
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm truncate">{product.name}</p>
                  {product.category && <p className="text-xs text-muted-foreground">{product.category}</p>}
                  <p className="text-sm font-semibold text-primary mt-0.5">{product.price.toFixed(2)} €</p>
                </div>
                <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 mt-0.5 ${
                  isSelected ? "bg-primary border-primary" : "border-muted-foreground/30"
                }`}>
                  {isSelected && <Check className="w-3 h-3 text-primary-foreground" />}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="flex items-center justify-between pt-2">
        <p className="text-sm text-muted-foreground">{selected.size} produit(s) sélectionné(s)</p>
        <Button type="button" onClick={save} disabled={saving} className="gap-2">
          {saving && <Loader2 className="w-4 h-4 animate-spin" />}
          Enregistrer la sélection
        </Button>
      </div>
    </div>
  );
}

const formSchema = z.object({
  name: z.string().min(1),
  model: z.string().min(1),
  communicationStyle: z.enum(["amical", "normal", "direct", "pedagogical"]),
  prompt: z.string().min(1),
  resources: z.string().optional(),
  timezone: z.string().optional(),
  responseDelay: z.coerce.number().min(0).max(300).optional(),
  emojiReactions: z.boolean().default(false),
  emojiList: z.string().optional(),
  isActive: z.boolean().default(true),
  language: z.string().optional(),
  greetingMessage: z.string().optional(),
  fallbackMessage: z.string().optional(),
  maxResponseLength: z.coerce.number().min(50).max(4000).optional(),
  personaName: z.string().optional(),
  workingHoursStart: z.string().optional(),
  workingHoursEnd: z.string().optional(),
  autoHandoff: z.boolean().default(false),
  handoffMessage: z.string().optional(),
  messageFrequencyLimit: z.coerce.number().min(1).max(1000).optional(),
  notificationPhone: z.string().optional(),
});

type ChatMessage = { role: "user" | "assistant"; content: string };
type QrStatus = "idle" | "connecting" | "qr_ready" | "pair_ready" | "connected" | "error";
type ConnectMethod = "qr" | "pair";

export default function EditAgent() {
  const { id } = useParams();
  const agentId = Number(id);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: agent, isLoading } = useGetAgent(agentId, {
    query: { enabled: !!agentId, queryKey: getGetAgentQueryKey(agentId) },
  });

  const updateAgent = useUpdateAgent();
  const testAgent = useTestAgent();

  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  const [testInput, setTestInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  // QR Code / Pairing code state — real Baileys
  const [qrDialogOpen, setQrDialogOpen] = useState(false);
  const [connectMethod, setConnectMethod] = useState<ConnectMethod>("qr");
  const [qrStatus, setQrStatus] = useState<QrStatus>("idle");
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [qrError, setQrError] = useState<string | null>(null);
  const [pairingPhone, setPairingPhone] = useState("");
  const [pairingCode, setPairingCode] = useState<string | null>(null);
  const [pairingLoading, setPairingLoading] = useState(false);
  const qrPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: "", model: "gpt-4o-mini", communicationStyle: "amical", prompt: "", resources: "",
      timezone: "UTC", responseDelay: 20, emojiReactions: false, emojiList: "",
      isActive: true, language: "fr", greetingMessage: "", fallbackMessage: "",
      maxResponseLength: 500, personaName: "", workingHoursStart: "00:00",
      workingHoursEnd: "23:59", autoHandoff: false, handoffMessage: "", messageFrequencyLimit: 60,
      notificationPhone: "",
    },
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const a = agent as any;

  useEffect(() => {
    if (agent) {
      form.reset({
        name: agent.name,
        model: agent.model,
        communicationStyle: (["amical", "normal", "direct", "pedagogical"].includes(agent.communicationStyle ?? "") ? agent.communicationStyle : "amical") as "amical" | "normal" | "direct" | "pedagogical",
        prompt: agent.prompt,
        timezone: agent.timezone || "UTC",
        responseDelay: agent.responseDelay ?? 20,
        emojiReactions: agent.emojiReactions || false,
        emojiList: agent.emojiList || "",
        isActive: agent.isActive,
        language: a.language || "fr",
        greetingMessage: a.greetingMessage || "",
        fallbackMessage: a.fallbackMessage || "",
        maxResponseLength: a.maxResponseLength || 500,
        personaName: a.personaName || "",
        workingHoursStart: a.workingHoursStart || "00:00",
        workingHoursEnd: a.workingHoursEnd || "23:59",
        autoHandoff: a.autoHandoff || false,
        handoffMessage: a.handoffMessage || "",
        messageFrequencyLimit: a.messageFrequencyLimit || 60,
        resources: a.resources || "",
        notificationPhone: a.notificationPhone || "",
      });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agent]);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [chatHistory]);

  // Cleanup poll on unmount
  useEffect(() => () => { if (qrPollRef.current) clearInterval(qrPollRef.current); }, []);

  const stopPolling = () => {
    if (qrPollRef.current) { clearInterval(qrPollRef.current); qrPollRef.current = null; }
  };

  const pollQrStatus = () => {
    qrPollRef.current = setInterval(async () => {
      try {
        const r = await fetch(`/api/agents/${agentId}/qr/status`);
        const data = await r.json() as { status: string; qrCode?: string; pairingCode?: string; phone?: string; error?: string };
        setQrStatus(data.status as QrStatus);
        if (data.qrCode) setQrCode(data.qrCode);
        if (data.pairingCode) setPairingCode(data.pairingCode);
        if (data.error) setQrError(data.error);
        if (data.status === "connected") {
          stopPolling();
          queryClient.invalidateQueries({ queryKey: getGetAgentQueryKey(agentId) });
          toast({ title: "WhatsApp connecté avec succès !" });
          setQrDialogOpen(false);
        }
      } catch { /* ignore */ }
    }, 3000);
  };

  const openConnectDialog = async () => {
    setQrDialogOpen(true);
    setQrStatus("connecting");
    setQrCode(null);
    setQrError(null);
    setPairingCode(null);
    setPairingPhone("");
    stopPolling();

    try {
      const r = await fetch(`/api/agents/${agentId}/qr/start`, { method: "POST" });
      const data = await r.json() as { status: string; qrCode?: string; phone?: string };
      setQrStatus(data.status as QrStatus);
      if (data.qrCode) setQrCode(data.qrCode);
      if (data.status === "connected") {
        queryClient.invalidateQueries({ queryKey: getGetAgentQueryKey(agentId) });
        return;
      }
      pollQrStatus();
    } catch {
      setQrStatus("error");
      setQrError("Impossible de démarrer la session WhatsApp");
    }
  };

  const requestPairingCode = async () => {
    if (!pairingPhone.trim()) return;
    setPairingLoading(true);
    setPairingCode(null);
    setQrError(null);
    try {
      const r = await fetch(`/api/agents/${agentId}/pair`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: pairingPhone.trim() }),
      });
      const data = await r.json() as { code?: string; error?: string };
      if (data.error) {
        setQrError(data.error);
      } else if (data.code) {
        setPairingCode(data.code);
        setQrStatus("pair_ready");
        if (!qrPollRef.current) pollQrStatus();
      }
    } catch {
      setQrError("Impossible d'obtenir le code de couplage");
    } finally {
      setPairingLoading(false);
    }
  };

  const refreshQr = async () => {
    setQrCode(null);
    setQrStatus("connecting");
    stopPolling();
    await openConnectDialog();
  };

  const [disconnecting, setDisconnecting] = useState(false);
  const [clearingSession, setClearingSession] = useState(false);
  const [togglingActive, setTogglingActive] = useState(false);

  const handleDisconnect = async () => {
    if (!confirm("Déconnecter WhatsApp ? Les identifiants sont conservés, vous pourrez vous reconnecter sans scanner à nouveau.")) return;
    setDisconnecting(true);
    try {
      const res = await fetch(`/api/agents/${agentId}/disconnect`, { method: "POST", credentials: "include" });
      if (!res.ok) throw new Error((await res.json() as { error?: string }).error ?? "Erreur serveur");
      queryClient.invalidateQueries({ queryKey: getGetAgentQueryKey(agentId) });
      toast({ title: "WhatsApp déconnecté" });
    } catch (err) {
      toast({ title: err instanceof Error ? err.message : "Erreur", variant: "destructive" });
    } finally {
      setDisconnecting(false);
    }
  };

  const handleClearSession = async () => {
    if (!confirm("Supprimer la session WhatsApp ? Cela effacera les identifiants stockés et vous devrez rescanner un QR code pour reconnecter.")) return;
    setClearingSession(true);
    try {
      const res = await fetch(`/api/agents/${agentId}/clear-session`, { method: "POST", credentials: "include" });
      if (!res.ok) throw new Error((await res.json() as { error?: string }).error ?? "Erreur serveur");
      queryClient.invalidateQueries({ queryKey: getGetAgentQueryKey(agentId) });
      toast({ title: "Session supprimée", description: "Reconnectez-vous via QR ou code de couplage." });
    } catch (err) {
      toast({ title: err instanceof Error ? err.message : "Erreur", variant: "destructive" });
    } finally {
      setClearingSession(false);
    }
  };

  const handleToggleActive = async () => {
    const newValue = !form.getValues("isActive");
    setTogglingActive(true);
    try {
      const res = await fetch(`/api/agents/${agentId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ isActive: newValue }),
      });
      if (!res.ok) throw new Error((await res.json() as { error?: string }).error ?? "Erreur serveur");
      form.setValue("isActive", newValue);
      queryClient.invalidateQueries({ queryKey: getGetAgentQueryKey(agentId) });
      toast({ title: newValue ? "Agent activé" : "Agent désactivé" });
    } catch (err) {
      toast({ title: err instanceof Error ? err.message : "Erreur", variant: "destructive" });
    } finally {
      setTogglingActive(false);
    }
  };

  const onSubmit = (values: z.infer<typeof formSchema>) => {
    updateAgent.mutate(
      { id: agentId, data: values as Parameters<typeof updateAgent.mutate>[0]["data"] },
      {
        onSuccess: (updated) => {
          toast({ title: "Agent mis à jour" });
          queryClient.setQueryData(getGetAgentQueryKey(agentId), updated);
        },
        onError: () => toast({ title: "Échec de la mise à jour", variant: "destructive" }),
      }
    );
  };

  const handleTestSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!testInput.trim()) return;
    const msg = testInput.trim();
    const updatedHistory = [...chatHistory, { role: "user" as const, content: msg }];
    setChatHistory(updatedHistory);
    setTestInput("");
    testAgent.mutate({ id: agentId, data: { message: msg, history: chatHistory } }, {
      onSuccess: (res: any) => {
        setChatHistory(prev => [...prev, { role: "assistant", content: res.response }]);
        // Refresh appointments in case one was just created via [APPT] marker
        queryClient.invalidateQueries({ queryKey: ["appointments"] });
        if (res.apptCreated) {
          toast({ title: "✅ Rendez-vous créé !", description: "Visible dans la section Rendez-vous." });
        }
        if (res.orderCreated) {
          toast({ title: "🛒 Commande créée !", description: "Visible dans la section Commandes." });
        }
      },
      onError: () => toast({ title: "Test échoué", variant: "destructive" }),
    });
  };

  if (isLoading || !agent) {
    return <div className="p-8 flex gap-6 h-full"><Skeleton className="w-1/2 h-full rounded-xl" /><Skeleton className="w-1/2 h-full rounded-xl" /></div>;
  }

  const isConnected = a.whatsappConnected as boolean;

  return (
    <div className="p-3 md:p-8 max-w-7xl mx-auto flex flex-col md:flex-row gap-4 md:gap-6 md:h-[calc(100vh-4rem)]">
      {/* Left: Config — shown second on mobile, first on desktop */}
      <div className="order-2 md:order-1 flex-1 flex flex-col min-h-0 md:overflow-hidden">
        {/* ── Header ── */}
        <div className="mb-3 md:mb-4 flex flex-col gap-2">
          {/* Row 1: title + active toggle */}
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-lg md:text-2xl font-bold tracking-tight truncate">{agent.name}</h1>
                <Badge variant={agent.isActive ? "default" : "secondary"} className="text-xs shrink-0">
                  {agent.isActive ? "Actif" : "Inactif"}
                </Badge>
              </div>
              <p className="text-muted-foreground mt-0.5 text-xs md:text-sm">Configurez le comportement de votre agent IA.</p>
            </div>
            {/* Activate / Deactivate — always visible */}
            <Button
              variant="outline"
              size="sm"
              onClick={handleToggleActive}
              disabled={togglingActive}
              className={`shrink-0 text-xs md:text-sm ${form.watch("isActive") ? "text-amber-600 border-amber-300 hover:bg-amber-50" : "text-green-600 border-green-300 hover:bg-green-50"}`}
            >
              {togglingActive ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <PowerOff className="w-3.5 h-3.5 mr-1" />}
              {form.watch("isActive") ? "Désactiver" : "Activer"}
            </Button>
          </div>

          {/* Row 2: WhatsApp status bar */}
          <div className="flex flex-wrap items-center gap-2">
            {isConnected ? (
              <>
                <div className="flex items-center gap-1.5 text-xs text-primary border border-primary/30 bg-primary/5 rounded-lg px-2.5 py-1.5 shrink-0">
                  <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                  <span className="font-medium truncate max-w-[120px] md:max-w-none">{a.whatsappPhone || "Connecté"}</span>
                </div>
                <Button variant="ghost" size="sm" onClick={handleDisconnect} disabled={disconnecting}
                  className="text-destructive hover:text-destructive text-xs h-8 px-2">
                  {disconnecting ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <XCircle className="w-3.5 h-3.5 mr-1" />}
                  Déconnecter
                </Button>
                <Button variant="ghost" size="sm" onClick={handleClearSession} disabled={clearingSession}
                  className="text-destructive hover:text-destructive text-xs h-8 px-2">
                  {clearingSession ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <Trash2 className="w-3.5 h-3.5 mr-1" />}
                  Effacer session
                </Button>
              </>
            ) : (
              <Button onClick={openConnectDialog} size="sm" className="gap-1.5 text-xs h-8">
                <QrCode className="w-3.5 h-3.5" />Connecter WhatsApp
              </Button>
            )}
          </div>
        </div>

        <ScrollArea className="flex-1 md:flex-1 border rounded-lg bg-card">
          <div className="p-6">
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
                <FormField control={form.control} name="isActive" render={({ field }) => (
                  <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                    <div className="space-y-0.5">
                      <FormLabel className="text-base">Statut actif</FormLabel>
                      <p className="text-sm text-muted-foreground">L'agent répond aux messages entrants.</p>
                    </div>
                    <FormControl><Switch checked={field.value} onCheckedChange={field.onChange} /></FormControl>
                  </FormItem>
                )} />

                <Tabs defaultValue="base">
                  <TabsList className="grid w-full grid-cols-2 md:grid-cols-4 h-auto">
                    <TabsTrigger value="base" className="text-xs md:text-sm">Config</TabsTrigger>
                    <TabsTrigger value="behavior" className="text-xs md:text-sm">Comportement</TabsTrigger>
                    <TabsTrigger value="advanced" className="text-xs md:text-sm">Avancé</TabsTrigger>
                    <TabsTrigger value="products" className="gap-1 text-xs md:text-sm"><Package className="w-3 h-3 md:w-3.5 md:h-3.5" />Produits</TabsTrigger>
                  </TabsList>

                  <TabsContent value="base" className="space-y-5 mt-5">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                      <FormField control={form.control} name="name" render={({ field }) => (
                        <FormItem><FormLabel>Nom de l'agent</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
                      )} />
                      <FormField control={form.control} name="personaName" render={({ field }) => (
                        <FormItem>
                          <FormLabel>Nom d'affichage (Persona)</FormLabel>
                          <FormControl><Input placeholder="Ex: Sophie, Alex..." {...field} /></FormControl>
                          <p className="text-xs text-muted-foreground">Le nom que l'agent utilise pour se présenter.</p>
                        </FormItem>
                      )} />
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                      <FormField control={form.control} name="model" render={({ field }) => (
                        <FormItem>
                          <FormLabel>Modèle IA</FormLabel>
                          <Select onValueChange={field.onChange} value={field.value}>
                            <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                            <SelectContent>
                              <SelectItem value="gpt-4o">GPT-4o (Plus performant)</SelectItem>
                              <SelectItem value="gpt-4o-mini">GPT-4o mini (Rapide)</SelectItem>
                              <SelectItem value="gpt-3.5-turbo">GPT-3.5 Turbo</SelectItem>
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )} />
                      <FormField control={form.control} name="language" render={({ field }) => (
                        <FormItem>
                          <FormLabel>Langue de réponse</FormLabel>
                          <Select onValueChange={field.onChange} value={field.value}>
                            <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                            <SelectContent>
                              <SelectItem value="fr">Français</SelectItem>
                              <SelectItem value="en">English</SelectItem>
                              <SelectItem value="ar">العربية</SelectItem>
                              <SelectItem value="es">Español</SelectItem>
                              <SelectItem value="pt">Português</SelectItem>
                              <SelectItem value="auto">Auto (langue du client)</SelectItem>
                            </SelectContent>
                          </Select>
                        </FormItem>
                      )} />
                    </div>
                    <FormField control={form.control} name="communicationStyle" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Style de communication</FormLabel>
                        <Select onValueChange={field.onChange} value={field.value}>
                          <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                          <SelectContent>
                            <SelectItem value="amical">Normal & Amical (recommandé)</SelectItem>
                            <SelectItem value="normal">Neutre (Standard)</SelectItem>
                            <SelectItem value="direct">Direct (Concis et précis)</SelectItem>
                            <SelectItem value="pedagogical">Pédagogique (Explique étape par étape)</SelectItem>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <FormField control={form.control} name="prompt" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Prompt système</FormLabel>
                        <FormControl><Textarea className="h-40 resize-none font-mono text-sm" {...field} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <FormField control={form.control} name="greetingMessage" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Message d'accueil</FormLabel>
                        <FormControl><Textarea rows={2} placeholder="Bonjour ! Comment puis-je vous aider ?" {...field} /></FormControl>
                        <p className="text-xs text-muted-foreground">Envoyé au début de chaque nouvelle conversation.</p>
                      </FormItem>
                    )} />
                    <FormField control={form.control} name="fallbackMessage" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Message de repli</FormLabel>
                        <FormControl><Textarea rows={2} placeholder="Je n'ai pas cette information. Un conseiller va vous contacter." {...field} /></FormControl>
                        <p className="text-xs text-muted-foreground">Envoyé quand l'IA ne sait pas répondre.</p>
                      </FormItem>
                    )} />
                  </TabsContent>

                  <TabsContent value="behavior" className="space-y-5 mt-5">
                    <FormField control={form.control} name="maxResponseLength" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Longueur max de réponse : {field.value} caractères</FormLabel>
                        <FormControl>
                          <Slider min={50} max={4000} step={50} value={[field.value || 500]} onValueChange={(v) => field.onChange(v[0])} />
                        </FormControl>
                      </FormItem>
                    )} />
                    <FormField control={form.control} name="messageFrequencyLimit" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Limite de messages par heure : {field.value}</FormLabel>
                        <FormControl>
                          <Slider min={1} max={200} step={1} value={[field.value || 60]} onValueChange={(v) => field.onChange(v[0])} />
                        </FormControl>
                      </FormItem>
                    )} />
                    <FormField control={form.control} name="responseDelay" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Délai de réponse : {field.value} secondes</FormLabel>
                        <FormControl>
                          <Slider min={0} max={240} step={5} value={[field.value || 0]} onValueChange={(v) => field.onChange(v[0])} />
                        </FormControl>
                        <p className="text-xs text-muted-foreground">Ajouter un délai pour paraître plus humain.</p>
                      </FormItem>
                    )} />
                    <FormField control={form.control} name="emojiReactions" render={({ field }) => (
                      <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                        <div className="space-y-0.5">
                          <FormLabel className="text-base">Réactions emoji</FormLabel>
                          <p className="text-sm text-muted-foreground">L'agent peut réagir aux messages avec des emojis.</p>
                        </div>
                        <FormControl><Switch checked={field.value} onCheckedChange={field.onChange} /></FormControl>
                      </FormItem>
                    )} />
                    {form.watch("emojiReactions") && (
                      <FormField control={form.control} name="emojiList" render={({ field }) => (
                        <FormItem><FormLabel>Emojis autorisés</FormLabel><FormControl><Input placeholder="👍 ❤️ 😊 🎉" {...field} /></FormControl></FormItem>
                      )} />
                    )}
                    <Separator />
                    <FormField control={form.control} name="autoHandoff" render={({ field }) => (
                      <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                        <div className="space-y-0.5">
                          <FormLabel className="text-base">Transfert automatique vers humain</FormLabel>
                          <p className="text-sm text-muted-foreground">L'agent demande à un humain de prendre le relais quand il ne sait pas répondre.</p>
                        </div>
                        <FormControl><Switch checked={field.value} onCheckedChange={field.onChange} /></FormControl>
                      </FormItem>
                    )} />
                    {form.watch("autoHandoff") && (
                      <FormField control={form.control} name="handoffMessage" render={({ field }) => (
                        <FormItem>
                          <FormLabel>Message de transfert</FormLabel>
                          <FormControl><Textarea rows={2} placeholder="Je vous transfère à un conseiller humain. Merci de patienter." {...field} /></FormControl>
                        </FormItem>
                      )} />
                    )}
                  </TabsContent>

                  <TabsContent value="advanced" className="space-y-5 mt-5">
                    <div>
                      <h3 className="text-sm font-semibold mb-3">Heures de travail</h3>
                      <p className="text-xs text-muted-foreground mb-4">L'agent ne répond que pendant ces heures.</p>
                      <div className="grid grid-cols-2 gap-4">
                        <FormField control={form.control} name="workingHoursStart" render={({ field }) => (
                          <FormItem><FormLabel>Heure de début</FormLabel><FormControl><Input type="time" {...field} /></FormControl></FormItem>
                        )} />
                        <FormField control={form.control} name="workingHoursEnd" render={({ field }) => (
                          <FormItem><FormLabel>Heure de fin</FormLabel><FormControl><Input type="time" {...field} /></FormControl></FormItem>
                        )} />
                      </div>
                    </div>
                    <Separator />
                    <FormField control={form.control} name="notificationPhone" render={({ field }) => (
                      <FormItem>
                        <FormLabel>📱 Numéro de notification WhatsApp</FormLabel>
                        <FormControl>
                          <Input placeholder="Ex: 33612345678 (sans + ni espaces)" {...field} />
                        </FormControl>
                        <p className="text-xs text-muted-foreground">
                          Ce numéro reçoit un message WhatsApp automatique à chaque nouveau rendez-vous ou commande. Peut être le même numéro que l'agent.
                        </p>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <Separator />
                    <FormField control={form.control} name="timezone" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Fuseau horaire</FormLabel>
                        <Select onValueChange={field.onChange} value={field.value}>
                          <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                          <SelectContent>
                            <SelectItem value="UTC">UTC</SelectItem>
                            <SelectItem value="Europe/Paris">Europe/Paris (CET)</SelectItem>
                            <SelectItem value="Africa/Abidjan">Africa/Abidjan (GMT)</SelectItem>
                            <SelectItem value="Africa/Dakar">Africa/Dakar (GMT)</SelectItem>
                            <SelectItem value="Africa/Douala">Africa/Douala (WAT)</SelectItem>
                            <SelectItem value="Africa/Nairobi">Africa/Nairobi (EAT)</SelectItem>
                            <SelectItem value="Africa/Casablanca">Africa/Casablanca (WET)</SelectItem>
                            <SelectItem value="America/New_York">America/New_York (ET)</SelectItem>
                            <SelectItem value="Asia/Dubai">Asia/Dubai (GST)</SelectItem>
                          </SelectContent>
                        </Select>
                      </FormItem>
                    )} />
                  </TabsContent>

                  <TabsContent value="products">
                    <AgentProductsTab agentId={agentId} />
                  </TabsContent>
                </Tabs>

                <div className="pt-4 flex justify-end">
                  <Button type="submit" disabled={updateAgent.isPending}>
                    {updateAgent.isPending ? "Enregistrement..." : "Enregistrer les modifications"}
                  </Button>
                </div>
              </form>
            </Form>
          </div>
        </ScrollArea>
      </div>

      {/* Right: Playground — shown first on mobile, second on desktop */}
      <div className="order-1 md:order-2 w-full md:w-[400px] flex flex-col h-[480px] md:h-full bg-card border rounded-lg overflow-hidden shrink-0">
        <div className="h-14 border-b flex items-center px-4 gap-2 font-medium bg-muted/30">
          <Bot className="w-4 h-4 text-primary" />Playground de test
        </div>
        <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-4">
          {chatHistory.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-muted-foreground text-center px-4">
              <Bot className="w-12 h-12 mb-4 opacity-20" />
              <p className="text-sm">Envoyez un message pour tester l'agent.</p>
            </div>
          ) : (
            chatHistory.map((msg, i) => (
              <div key={i} className={`flex gap-3 max-w-[85%] ${msg.role === "user" ? "ml-auto flex-row-reverse" : ""}`}>
                <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${msg.role === "user" ? "bg-primary text-primary-foreground" : "bg-muted"}`}>
                  {msg.role === "user" ? <User className="w-4 h-4" /> : <Bot className="w-4 h-4" />}
                </div>
                <div className={`px-4 py-2 rounded-2xl text-sm whitespace-pre-wrap ${msg.role === "user" ? "bg-primary text-primary-foreground rounded-tr-sm" : "bg-muted rounded-tl-sm"}`}>
                  {msg.content}
                </div>
              </div>
            ))
          )}
          {testAgent.isPending && (
            <div className="flex gap-3 max-w-[85%]">
              <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center shrink-0"><Bot className="w-4 h-4" /></div>
              <div className="px-4 py-3 rounded-2xl bg-muted rounded-tl-sm flex gap-1 items-center">
                <div className="w-1.5 h-1.5 rounded-full bg-muted-foreground/50 animate-bounce" />
                <div className="w-1.5 h-1.5 rounded-full bg-muted-foreground/50 animate-bounce [animation-delay:0.2s]" />
                <div className="w-1.5 h-1.5 rounded-full bg-muted-foreground/50 animate-bounce [animation-delay:0.4s]" />
              </div>
            </div>
          )}
        </div>
        <form onSubmit={handleTestSubmit} className="p-4 border-t bg-muted/10">
          <div className="relative">
            <Input placeholder="Tapez un message..." value={testInput} onChange={(e) => setTestInput(e.target.value)} className="pr-10" disabled={testAgent.isPending} />
            <Button type="submit" size="icon" variant="ghost" className="absolute right-1 top-1 w-8 h-8 text-primary" disabled={!testInput.trim() || testAgent.isPending}>
              <Send className="w-4 h-4" />
            </Button>
          </div>
        </form>
      </div>

      {/* WhatsApp Connect Dialog — QR + Pairing Code */}
      <Dialog open={qrDialogOpen} onOpenChange={(open) => { if (!open) { stopPolling(); setPairingCode(null); setPairingPhone(""); } setQrDialogOpen(open); }}>
        <DialogContent className="w-[calc(100vw-2rem)] max-w-md rounded-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <Smartphone className="w-5 h-5 text-primary shrink-0" />
              Connecter WhatsApp
            </DialogTitle>
            <DialogDescription className="text-xs sm:text-sm">
              Choisissez la méthode pour lier votre numéro à cet agent.
            </DialogDescription>
          </DialogHeader>

          {/* Method switcher */}
          {qrStatus !== "connected" && (
            <div className="flex gap-2 rounded-lg border p-1 bg-muted/30">
              <button
                onClick={() => { setConnectMethod("qr"); setPairingCode(null); setQrError(null); }}
                className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-md text-sm font-medium transition-colors ${connectMethod === "qr" ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"}`}
              >
                <QrCode className="w-4 h-4" />
                QR Code
              </button>
              <button
                onClick={() => { setConnectMethod("pair"); setQrCode(null); setQrError(null); }}
                className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-md text-sm font-medium transition-colors ${connectMethod === "pair" ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"}`}
              >
                <Hash className="w-4 h-4" />
                Code de couplage
              </button>
            </div>
          )}

          <div className="flex flex-col items-center gap-4">

            {/* ── QR CODE METHOD ── */}
            {connectMethod === "qr" && qrStatus !== "connected" && (
              <>
                <div className="border-2 border-primary/20 rounded-2xl p-4 bg-white shadow-sm w-full flex justify-center">
                  {qrStatus === "connecting" && (
                    <div className="w-[200px] h-[200px] flex flex-col items-center justify-center gap-3">
                      <Loader2 className="w-10 h-10 animate-spin text-primary" />
                      <p className="text-sm text-muted-foreground text-center">Connexion aux serveurs WhatsApp...</p>
                    </div>
                  )}
                  {qrStatus === "qr_ready" && qrCode && (
                    <img src={qrCode} alt="QR Code WhatsApp" className="w-[200px] h-[200px]" />
                  )}
                  {qrStatus === "error" && (
                    <div className="w-[200px] h-[200px] flex flex-col items-center justify-center gap-3 text-center">
                      <XCircle className="w-10 h-10 text-destructive" />
                      <p className="text-sm text-muted-foreground">{qrError || "Erreur de connexion"}</p>
                    </div>
                  )}
                </div>

                {qrStatus === "qr_ready" && (
                  <div className="w-full bg-primary/5 border border-primary/20 rounded-lg p-3 text-xs sm:text-sm space-y-1">
                    <p className="font-medium text-primary">Comment scanner :</p>
                    <p className="text-muted-foreground">1. Ouvrez WhatsApp sur votre téléphone</p>
                    <p className="text-muted-foreground">2. Allez dans <span className="font-medium text-foreground">⋮ → Appareils liés → Lier un appareil</span></p>
                    <p className="text-muted-foreground">3. Pointez votre caméra vers ce QR code</p>
                  </div>
                )}
                {qrStatus === "qr_ready" && (
                  <p className="text-xs text-muted-foreground">Le QR code expire après 40 secondes.</p>
                )}

                <div className="flex flex-col sm:flex-row gap-2 w-full">
                  {(qrStatus === "error" || qrStatus === "qr_ready") && (
                    <Button variant="outline" onClick={refreshQr} className="gap-2 flex-1 text-sm">
                      <RefreshCw className="w-4 h-4" />
                      Nouveau QR
                    </Button>
                  )}
                  <Button variant="ghost" onClick={() => { stopPolling(); setQrDialogOpen(false); }} className="flex-1 text-sm">
                    {qrStatus === "connecting" ? "Annuler" : "Fermer"}
                  </Button>
                </div>
              </>
            )}

            {/* ── PAIRING CODE METHOD ── */}
            {connectMethod === "pair" && qrStatus !== "connected" && (
              <div className="w-full flex flex-col gap-4">
                <div className="bg-muted/30 border rounded-lg p-3 text-xs sm:text-sm space-y-1">
                  <p className="font-medium">Comment obtenir le code :</p>
                  <p className="text-muted-foreground">1. Ouvrez WhatsApp sur votre téléphone</p>
                  <p className="text-muted-foreground">2. Allez dans <span className="font-medium text-foreground">⋮ → Appareils liés → Lier avec un numéro</span></p>
                  <p className="text-muted-foreground">3. Entrez votre numéro ci-dessous, obtenez le code et saisissez-le dans WhatsApp</p>
                </div>

                {qrStatus === "connecting" && (
                  <div className="flex items-center justify-center gap-2 py-2 text-sm text-muted-foreground">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Préparation de la session...
                  </div>
                )}

                {(qrStatus === "qr_ready" || qrStatus === "pair_ready" || qrStatus === "error") && (
                  <div className="flex flex-col gap-3">
                    <div className="flex gap-2">
                      <Input
                        placeholder="Ex: 33612345678 (sans +)"
                        value={pairingPhone}
                        onChange={(e) => setPairingPhone(e.target.value)}
                        className="flex-1 text-sm"
                        disabled={pairingLoading}
                        onKeyDown={(e) => { if (e.key === "Enter") requestPairingCode(); }}
                      />
                      <Button
                        onClick={requestPairingCode}
                        disabled={!pairingPhone.trim() || pairingLoading}
                        className="shrink-0 text-sm"
                      >
                        {pairingLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Obtenir"}
                      </Button>
                    </div>

                    {qrError && (
                      <div className="flex items-center gap-2 text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-lg px-3 py-2">
                        <XCircle className="w-4 h-4 shrink-0" />
                        <span>{qrError}</span>
                      </div>
                    )}

                    {pairingCode && (
                      <div className="flex flex-col items-center gap-2 bg-primary/5 border border-primary/20 rounded-xl p-4">
                        <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">Votre code de couplage</p>
                        <p className="text-3xl sm:text-4xl font-bold tracking-widest text-primary font-mono">{pairingCode}</p>
                        <p className="text-xs text-muted-foreground text-center">Saisissez ce code dans WhatsApp → Lier avec un numéro</p>
                      </div>
                    )}
                  </div>
                )}

                <Button variant="ghost" onClick={() => { stopPolling(); setQrDialogOpen(false); }} className="w-full text-sm">
                  {qrStatus === "connecting" ? "Annuler" : "Fermer"}
                </Button>
              </div>
            )}

            {/* ── CONNECTED ── */}
            {qrStatus === "connected" && (
              <div className="flex flex-col items-center gap-3 py-4">
                <CheckCircle2 className="w-14 h-14 text-primary" />
                <p className="text-base font-semibold">WhatsApp connecté !</p>
                <Button onClick={() => { stopPolling(); setQrDialogOpen(false); }} className="mt-2">Fermer</Button>
              </div>
            )}

          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
