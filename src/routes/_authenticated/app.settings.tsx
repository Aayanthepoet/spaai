import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQueryClient, useQuery, useMutation } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { LogOut, User as UserIcon, Mail, Building2, Calendar, Upload, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

export const Route = createFileRoute("/_authenticated/app/settings")({
  head: () => ({ meta: [{ title: "Settings — PropAI" }] }),
  component: SettingsPage,
});

function SettingsPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const { data: profile, isLoading } = useQuery({
    queryKey: ["profile", user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, email, full_name, company, avatar_url, created_at, updated_at")
        .eq("id", user!.id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const [fullName, setFullName] = useState("");
  const [company, setCompany] = useState("");
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Clean up object URLs when replaced/unmounted
  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  useEffect(() => {
    if (profile) {
      setFullName(profile.full_name ?? "");
      setCompany(profile.company ?? "");
    }
  }, [profile]);

  // Resolve signed URL for avatar (private bucket)
  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!profile?.avatar_url) {
        setAvatarUrl(null);
        return;
      }
      const { data, error } = await supabase.storage
        .from("avatars")
        .createSignedUrl(profile.avatar_url, 3600);
      if (!cancelled && !error) {
        setAvatarUrl(data?.signedUrl ?? null);
        setPreviewUrl((prev) => {
          if (prev) URL.revokeObjectURL(prev);
          return null;
        });
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [profile?.avatar_url]);

  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [uploadPhase, setUploadPhase] = useState<"uploading" | "saving" | null>(null);

  const uploadAvatar = useMutation({
    mutationFn: async (file: File) => {
      if (!user?.id) throw new Error("Not signed in");
      if (!file.type.startsWith("image/")) throw new Error("Only image files are allowed (PNG, JPG, WebP, GIF)");
      if (file.size > 5 * 1024 * 1024) {
        const mb = (file.size / 1024 / 1024).toFixed(1);
        throw new Error(`Image is ${mb}MB — max 5MB`);
      }

      // Compress/resize unless GIF (preserve animation)
      let upload: Blob = file;
      let ext = "jpg";
      let contentType = "image/jpeg";
      if (file.type === "image/gif") {
        upload = file;
        ext = "gif";
        contentType = "image/gif";
      } else {
        const compressed = await compressImage(file, 512, 0.9);
        upload = compressed;
        ext = "jpg";
        contentType = "image/jpeg";
      }

      const path = `${user.id}/avatar-${Date.now()}.${ext}`;

      // Get a signed upload URL so we can drive the PUT via XHR for progress
      setUploadPhase("uploading");
      setUploadProgress(0);
      const { data: signed, error: signErr } = await supabase.storage
        .from("avatars")
        .createSignedUploadUrl(path);
      if (signErr || !signed) throw new Error(signErr?.message || "Could not start upload");

      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("PUT", signed.signedUrl, true);
        xhr.setRequestHeader("x-upsert", "false");
        xhr.setRequestHeader("Content-Type", contentType);
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) {
            setUploadProgress(Math.round((e.loaded / e.total) * 100));
          }
        };
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) resolve();
          else reject(new Error(`Upload failed (${xhr.status}): ${xhr.responseText || xhr.statusText}`));
        };
        xhr.onerror = () => reject(new Error("Network error during upload"));
        xhr.onabort = () => reject(new Error("Upload was cancelled"));
        xhr.send(upload);
      });

      setUploadPhase("saving");
      setUploadProgress(100);

      if (profile?.avatar_url) {
        await supabase.storage.from("avatars").remove([profile.avatar_url]);
      }

      const { error: dbErr } = await supabase
        .from("profiles")
        .update({ avatar_url: path })
        .eq("id", user.id);
      if (dbErr) throw new Error(`Couldn't save profile: ${dbErr.message}`);
    },
    onSuccess: () => {
      toast.success("Avatar updated", { description: "Your new profile picture is live." });
      qc.invalidateQueries({ queryKey: ["profile", user?.id] });
      // Preview is cleared once the new signed URL loads (see signed-URL effect)
    },
    onError: (e: Error) => {
      toast.error("Avatar upload failed", { description: e.message });
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
        setPreviewUrl(null);
      }
    },
    onSettled: () => {
      setUploadProgress(null);
      setUploadPhase(null);
    },
  });

  const save = useMutation({
    mutationFn: async () => {
      if (!user?.id) throw new Error("Not signed in");
      const { error } = await supabase
        .from("profiles")
        .update({ full_name: fullName, company })
        .eq("id", user.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Profile updated");
      qc.invalidateQueries({ queryKey: ["profile", user?.id] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const resetPassword = useMutation({
    mutationFn: async () => {
      if (!user?.email) throw new Error("No email on account");
      const { error } = await supabase.auth.resetPasswordForEmail(user.email, {
        redirectTo: `${window.location.origin}/reset-password`,
      });
      if (error) throw error;
    },
    onSuccess: () => toast.success("Password reset email sent"),
    onError: (e: Error) => toast.error(e.message),
  });

  async function signOut() {
    await qc.cancelQueries();
    qc.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }

  const createdAt = profile?.created_at
    ? new Date(profile.created_at).toLocaleDateString()
    : "—";

  return (
    <div className="space-y-8 max-w-2xl">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Settings</h1>
        <p className="mt-1 text-sm text-[var(--w55)]">
          Manage your profile and account.
        </p>
      </div>

      <section className="rounded-xl border border-border bg-card/40 p-6 space-y-4">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <UserIcon className="h-4 w-4" /> Account
        </h2>
        <div className="grid gap-3 text-sm">
          <Row icon={Mail} label="Email" value={user?.email ?? "—"} />
          <Row icon={Calendar} label="Member since" value={createdAt} />
        </div>
      </section>

      <section className="rounded-xl border border-border bg-card/40 p-6 space-y-4">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <Building2 className="h-4 w-4" /> Profile
        </h2>
        <div className="grid gap-4">
          <div className="flex items-center gap-4">
            <div className="h-20 w-20 rounded-full overflow-hidden bg-muted border border-border flex items-center justify-center shrink-0">
              {previewUrl || avatarUrl ? (
                <img src={previewUrl ?? avatarUrl!} alt="Avatar" className="h-full w-full object-cover" />
              ) : (
                <UserIcon className="h-8 w-8 text-[var(--w45)]" />
              )}
            </div>
            <div className="flex-1">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) {
                    const MAX_SIZE_MB = 5;
                    const MAX_SIZE_BYTES = MAX_SIZE_MB * 1024 * 1024;
                    
                    if (file.size > MAX_SIZE_BYTES) {
                      const mb = (file.size / 1024 / 1024).toFixed(1);
                      toast.error("File is too large", {
                        description: `The selected image is ${mb}MB. Please select a file smaller than ${MAX_SIZE_MB}MB.`
                      });
                      e.target.value = "";
                      return;
                    }
                    
                    if (!file.type.startsWith("image/")) {
                      toast.error("Invalid file type", {
                        description: "Only image files are allowed (PNG, JPG, WebP, GIF)."
                      });
                      e.target.value = "";
                      return;
                    }

                    if (previewUrl) URL.revokeObjectURL(previewUrl);
                    setPreviewUrl(URL.createObjectURL(file));
                    uploadAvatar.mutate(file);
                  }
                  e.target.value = "";
                }}
              />
              <Button
                variant="outline"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploadAvatar.isPending}
              >
                {uploadAvatar.isPending ? (
                  <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Uploading…</>
                ) : (
                  <><Upload className="h-4 w-4 mr-2" /> Upload avatar</>
                )}
              </Button>
              <p className="text-xs text-[var(--w45)] mt-1.5">PNG or JPG, up to 5MB</p>
              {uploadAvatar.isPending && (
                <div className="mt-3 space-y-1.5">
                  <Progress value={uploadPhase === "saving" ? 100 : uploadProgress ?? 0} className="h-1.5" />
                  <div className="flex justify-between text-xs text-[var(--w55)]">
                    <span>
                      {uploadPhase === "saving"
                        ? "Saving to profile…"
                        : uploadProgress != null
                          ? `Uploading… ${uploadProgress}%`
                          : "Preparing…"}
                    </span>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="full_name">Full name</Label>
            <Input
              id="full_name"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              disabled={isLoading}
              placeholder="Your name"
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="company">Company</Label>
            <Input
              id="company"
              value={company}
              onChange={(e) => setCompany(e.target.value)}
              disabled={isLoading}
              placeholder="Company name"
            />
          </div>
          <div>
            <Button
              onClick={() => save.mutate()}
              disabled={save.isPending || isLoading}
            >
              {save.isPending ? "Saving…" : "Save changes"}
            </Button>
          </div>
        </div>
      </section>

      <section className="rounded-xl border border-border bg-card/40 p-6 space-y-4">
        <h2 className="text-lg font-semibold">Security</h2>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm text-[var(--w55)]">
            Send a password reset link to your email.
          </div>
          <Button
            variant="outline"
            onClick={() => resetPassword.mutate()}
            disabled={resetPassword.isPending}
          >
            {resetPassword.isPending ? "Sending…" : "Reset password"}
          </Button>
        </div>
      </section>

      <section className="rounded-xl border border-red-900/40 bg-red-950/10 p-6 space-y-4">
        <h2 className="text-lg font-semibold text-red-300">Danger zone</h2>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm text-[var(--w55)]">
            Sign out of this device.
          </div>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="destructive">
                <LogOut className="h-4 w-4 mr-2" /> Sign out
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Sign out?</AlertDialogTitle>
                <AlertDialogDescription>
                  You'll need to sign in again to access your workspace.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={signOut}>Sign out</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </section>
    </div>
  );
}

function Row({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-2 border-b border-border/50 last:border-0">
      <div className="flex items-center gap-2 text-[var(--w55)]">
        <Icon className="h-4 w-4" />
        <span>{label}</span>
      </div>
      <span className="font-mono text-xs truncate">{value}</span>
    </div>
  );
}

/**
 * Resize an image to fit within maxSize x maxSize (preserving aspect ratio)
 * and re-encode as JPEG. Skips upscaling.
 */
async function compressImage(file: File, maxSize: number, quality: number): Promise<Blob> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result as string);
    fr.onerror = () => reject(new Error("Could not read image"));
    fr.readAsDataURL(file);
  });

  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error("Could not decode image"));
    el.src = dataUrl;
  });

  const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
  const w = Math.round(img.width * scale);
  const h = Math.round(img.height * scale);

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas not supported");
  ctx.drawImage(img, 0, 0, w, h);

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", quality),
  );
  if (!blob) throw new Error("Could not encode image");
  return blob;
}
