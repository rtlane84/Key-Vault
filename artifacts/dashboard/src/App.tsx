import { Switch, Route, Router as WouterRouter, useLocation, Redirect } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import { AppLayout } from "@/components/layout";
import LoginPage from "@/pages/login";
import DashboardPage from "@/pages/dashboard";
import ProductsPage from "@/pages/products";
import ProductDetailPage from "@/pages/product-detail";
import OrdersPage from "@/pages/orders";
import EbayPage from "@/pages/ebay";
import LogsPage from "@/pages/logs";
import { isAuthenticated, clearToken } from "@/lib/auth";
function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: (failureCount, error) => {
          // Don't retry on 401 — token is invalid/expired
          const status = (error as { status?: number } | undefined)?.status;
          if (status === 401) return false;
          return failureCount < 1;
        },
      },
      mutations: {
        onError: (error) => {
          const status = (error as { status?: number } | undefined)?.status;
          if (status === 401) {
            clearToken();
            window.location.href = "/login";
          }
        },
      },
    },
  });
}

const queryClient = makeQueryClient();

function ProtectedRoute({ component: Component }: { component: React.ComponentType }) {
  const [location] = useLocation();
  if (!isAuthenticated()) {
    return <Redirect to="/login" />;
  }
  return <Component />;
}

function Router() {
  return (
    <Switch>
      <Route path="/login" component={LoginPage} />
      <Route path="/">
        {() => (
          <AppLayout>
            <Switch>
              <Route path="/" component={() => <ProtectedRoute component={DashboardPage} />} />
              <Route path="/products" component={() => <ProtectedRoute component={ProductsPage} />} />
              <Route path="/products/:id" component={() => <ProtectedRoute component={ProductDetailPage} />} />
              <Route path="/orders" component={() => <ProtectedRoute component={OrdersPage} />} />
              <Route path="/ebay" component={() => <ProtectedRoute component={EbayPage} />} />
              <Route path="/logs" component={() => <ProtectedRoute component={LogsPage} />} />
              <Route component={NotFound} />
            </Switch>
          </AppLayout>
        )}
      </Route>
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
