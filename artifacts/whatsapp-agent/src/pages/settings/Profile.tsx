import { useGetProfile, useUpdateProfile, getGetProfileQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Progress } from "@/components/ui/progress";
import { User, Zap, CreditCard } from "lucide-react";

const formSchema = z.object({
  name: z.string().min(1, "Le nom est requis"),
  email: z.string().email("Email invalide"),
});

export default function Profile() {
  const { data: profile, isLoading } = useGetProfile();
  const updateProfile = useUpdateProfile();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: { name: "", email: "" },
  });

  useEffect(() => {
    if (profile) form.reset({ name: profile.name, email: profile.email });
  }, [profile, form]);

  const onSubmit = (values: z.infer<typeof formSchema>) => {
    updateProfile.mutate({ data: values }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetProfileQueryKey() });
        toast({ title: "Profil mis à jour" });
      },
      onError: () => toast({ title: "Erreur lors de la mise à jour", variant: "destructive" }),
    });
  };

  if (isLoading) return <div className="p-4 md:p-8"><Skeleton className="h-64 max-w-2xl" /></div>;

  const usagePercent = profile ? Math.min(100, (profile.creditsUsed / profile.creditsTotal) * 100) : 0;

  return (
    <div className="p-4 md:p-8 max-w-2xl flex flex-col gap-4 md:gap-6">
      <div>
        <h1 className="text-xl md:text-3xl font-bold tracking-tight">Mon profil</h1>
        <p className="text-muted-foreground mt-1 text-xs md:text-sm">Gérez vos informations personnelles et votre abonnement.</p>
      </div>

      {/* Personal info */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <User className="w-4 h-4" /> Informations personnelles
          </CardTitle>
          <CardDescription>Mettez à jour vos coordonnées de contact.</CardDescription>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField control={form.control} name="name" render={({ field }) => (
                <FormItem>
                  <FormLabel>Nom complet</FormLabel>
                  <FormControl><Input {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="email" render={({ field }) => (
                <FormItem>
                  <FormLabel>Adresse email</FormLabel>
                  <FormControl><Input type="email" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <Button type="submit" disabled={updateProfile.isPending}>
                {updateProfile.isPending ? "Enregistrement..." : "Enregistrer les modifications"}
              </Button>
            </form>
          </Form>
        </CardContent>
      </Card>

      {/* Usage */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Zap className="w-4 h-4 text-yellow-500" /> Utilisation
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span className="font-medium">Crédits utilisés</span>
              <span className="text-muted-foreground">{profile?.creditsUsed} / {profile?.creditsTotal}</span>
            </div>
            <Progress value={usagePercent} className="h-2" />
            <p className="text-xs text-muted-foreground">{Math.round(usagePercent)}% du quota utilisé</p>
          </div>

          <div className="grid grid-cols-2 gap-4 pt-3 border-t">
            <div>
              <div className="text-xs text-muted-foreground mb-1">Plan actuel</div>
              <Badge variant="secondary" className="capitalize font-semibold">
                <CreditCard className="w-3 h-3 mr-1" />
                {profile?.plan ?? "Free"}
              </Badge>
            </div>
            <div>
              <div className="text-xs text-muted-foreground mb-1">Agents actifs</div>
              <div className="font-bold text-lg">{profile?.activeAgents ?? 0}</div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
