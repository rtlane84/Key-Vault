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
import EbayListingsPage from "@/pages/ebay-listings";
import EbayOrdersPage from "@/pages/ebay-orders";
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
        <ProtectedRoute component={() => (
          <AppLayout>
            <DashboardPage />
          </AppLayout>
        )} />
      </Route>

      <Route path="/products">
        <ProtectedRoute component={() => (
          <AppLayout>
            <ProductsPage />
          </AppLayout>
        )} />
      </Route>

      <Route path="/products/:id">
        <ProtectedRoute component={() => (
          <AppLayout>
            <ProductDetailPage />
          </AppLayout>
        )} />
      </Route>

      <Route path="/orders">
        <ProtectedRoute component={() => (
          <AppLayout>
            <OrdersPage />
          </AppLayout>
        )} />
      </Route>

      <Route path="/ebay">
        <ProtectedRoute component={() => (
          <AppLayout>
            <EbayPage />
          </AppLayout>
        )} />
      </Route>

      <Route path="/ebay/listings">
        <ProtectedRoute component={() => (
          <AppLayout>
            <EbayListingsPage />
          </AppLayout>
        )} />
      </Route>

      <Route path="/ebay/orders">
        <ProtectedRoute component={() => (
          <AppLayout>
            <EbayOrdersPage />
          </AppLayout>
        )} />
      </Route>

      <Route path="/logs">
        <ProtectedRoute component={() => (
          <AppLayout>
            <LogsPage />
          </AppLayout>
        )} />
      </Route>

      <Route component={NotFound} />
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
