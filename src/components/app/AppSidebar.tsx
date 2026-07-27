import { Link, useRouterState, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarFooter,
  useSidebar,
} from "@/components/ui/sidebar";
import {
  LayoutDashboard,
  School,
  Users,
  PhoneCall,
  ListChecks,
  Megaphone,
  Bot,
  Flame,
  Send,
  ScrollText,
  ShieldOff,
  LogOut,
  Settings,
  Share2,
  Home,
} from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";

const items = [
  { key: "landingPage", url: "/", icon: Home, exact: true },
  { key: "overview", url: "/app", icon: LayoutDashboard, exact: true },
  { key: "propaiAgent", url: "/app/agent", icon: Bot },
  { key: "leadScoring", url: "/app/scoring", icon: Flame },
  { key: "schools", url: "/app/schools", icon: School },
  { key: "staff", url: "/app/owners", icon: Users },
  { key: "contactsResolver", url: "/app/contacts", icon: PhoneCall },
  { key: "leadLists", url: "/app/lead-lists", icon: ListChecks },
  { key: "campaignsLanguage", url: "/app/campaigns", icon: Megaphone },
  { key: "outreach", url: "/app/outreach", icon: Send },
  { key: "socialAmplifier", url: "/app/social", icon: Share2 },
  { key: "auditLog", url: "/app/audit", icon: ScrollText },
  { key: "smsOptOuts", url: "/app/opt-outs", icon: ShieldOff },
  { key: "settings", url: "/app/settings", icon: Settings },
] as const;


export function AppSidebar() {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { user } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { t } = useTranslation();

  const isActive = (url: string, exact?: boolean) =>
    exact ? pathname === url : pathname === url || pathname.startsWith(url + "/");

  async function signOut() {
    await qc.cancelQueries();
    qc.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }

  return (
    <Sidebar collapsible="icon">
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>{t("sidebar.workspace")}</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {items.map((item) => {
                const exact = "exact" in item ? item.exact : false;
                const title = t(`sidebar.${item.key}`);
                return (
                  <SidebarMenuItem key={item.key}>
                    <SidebarMenuButton asChild isActive={isActive(item.url, exact)}>
                      <Link to={item.url} className="flex items-center gap-2">
                        <item.icon className="h-4 w-4" />
                        {!collapsed && <span>{title}</span>}
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      {user && (
        <SidebarFooter className="border-t border-border p-2">
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                onClick={signOut}
                className="w-full justify-start text-red-400 hover:text-red-300 hover:bg-red-950/20"
                title="Sign out"
              >
                <LogOut className="h-4 w-4" />
                {!collapsed && (
                  <span className="flex-1 text-left truncate text-xs">
                    {user.email}
                  </span>
                )}
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarFooter>
      )}
    </Sidebar>
  );
}
