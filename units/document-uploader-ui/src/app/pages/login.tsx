import { useState } from 'react';
import { useNavigate } from 'react-router';
import { Alert, Button, Input, Select } from '@opus2-platform/codex';
import { Opus2Logo } from '../components/opus2-logo';
import type { SelectItemType } from '@opus2-platform/codex';
import { LogIn01, Server02 } from '@opus2-platform/icons';

const LOGIN_IMAGE =
  'https://images.unsplash.com/photo-1564846824194-346b7871b855?q=80&w=1287&auto=format&fit=crop&ixlib=rb-4.1.0&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D';

interface Server {
  id: string;
  name: string;
  url: string;
  region: string;
}

const availableServers: Server[] = [
  { id: 'uk04', name: 'UK04', url: 'uk04.opus2.com', region: 'United Kingdom' },
  { id: 'us01', name: 'US01', url: 'us01.opus2.com', region: 'United States' },
  { id: 'eu02', name: 'EU02', url: 'eu02.opus2.com', region: 'European Union' },
];

const serverItems: SelectItemType[] = availableServers.map((server) => ({
  id: server.id,
  label: `${server.name} - ${server.url}`,
  supportingText: server.region,
}));

export function Login() {
  const navigate = useNavigate();
  const [selectedServerId, setSelectedServerId] = useState(availableServers[0].id);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  const selectedServer = availableServers.find((server) => server.id === selectedServerId)!;

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!email || !password) {
      setError('Please enter both email and password');
      return;
    }

    setIsLoading(true);

    setTimeout(() => {
      setIsLoading(false);
      sessionStorage.setItem('selectedServer', JSON.stringify(selectedServer));
      navigate('/workspaces');
    }, 1500);
  };

  return (
    <section className="grid min-h-screen grid-cols-1 overflow-hidden bg-primary lg:grid-cols-2">
      <div className="flex flex-col bg-primary">
        <div className="flex flex-1 justify-center px-4 py-12 md:items-center md:px-8">
          <div className="flex w-full flex-col gap-8 sm:max-w-[360px]">
            <div className="flex flex-col items-center gap-6 text-center">
              <div className="relative flex size-24 items-center justify-center">
                <div
                  className="auth-grid-overlay-light pointer-events-none absolute inset-0 rounded-full"
                  aria-hidden="true"
                />
                <Opus2Logo className="relative z-10 h-7" aria-label="Opus 2" />
              </div>

              <div className="auth-rise flex flex-col gap-2" style={{ animationDelay: '60ms' }}>
                <h1 className="text-display-xs font-semibold text-primary md:text-display-sm">
                  Welcome back
                </h1>
                <p className="text-sm text-tertiary md:text-md">
                  Sign in to access Document Transfer on{' '}
                  <span className="font-medium text-secondary">{selectedServer.name}</span>
                  <span className="text-quaternary"> · </span>
                  {selectedServer.region}
                </p>
              </div>
            </div>

            <form
              onSubmit={handleLogin}
              className="auth-rise relative z-10 flex flex-col gap-6"
              style={{ animationDelay: '120ms' }}
            >
              <div className="flex flex-col gap-5">
                <Select
                  size="sm"
                  label="Production Server"
                  items={serverItems}
                  selectedKey={selectedServerId}
                  onSelectionChange={(key) => {
                    if (key) setSelectedServerId(String(key));
                  }}
                  icon={Server02}
                >
                  {(item) => (
                    <Select.Item
                      id={item.id}
                      label={item.label}
                      supportingText={item.supportingText}
                    />
                  )}
                </Select>

                <Input
                  size="sm"
                  label="Email Address"
                  type="email"
                  value={email}
                  onChange={setEmail}
                  placeholder="your.email@company.com"
                  isDisabled={isLoading}
                  isRequired
                />

                <Input
                  size="sm"
                  label="Password"
                  type="password"
                  value={password}
                  onChange={setPassword}
                  placeholder="Enter your password"
                  isDisabled={isLoading}
                  isRequired
                />
              </div>

              {error && <Alert color="error" title={error} />}

              <Button
                size="sm"
                color="primary"
                type="submit"
                isDisabled={isLoading}
                isLoading={isLoading}
                showTextWhileLoading
                iconLeading={LogIn01}
                className="w-full"
              >
                Sign In
              </Button>
            </form>

            <p
              className="auth-rise text-center text-xs text-tertiary"
              style={{ animationDelay: '180ms' }}
            >
              Need help signing in? Contact your system administrator
            </p>

            <div className="auth-rise" style={{ animationDelay: '220ms' }}>
              <Alert
                color="gray"
                title="Demo mode"
                description="Any credentials will work for demonstration purposes"
              />
            </div>
          </div>
        </div>

        <footer className="hidden p-8 pt-11 lg:block">
          <p className="text-sm text-tertiary">
            © {new Date().getFullYear()} Opus 2. All rights reserved.
          </p>
        </footer>
      </div>

      <div className="relative hidden overflow-hidden lg:block">
        <img
          src={LOGIN_IMAGE}
          className="absolute inset-0 size-full object-cover object-center"
          alt="Professional signing documents at a desk"
        />
        <div
          className="absolute inset-0 bg-gradient-to-t from-brand-section/50 via-brand-section/10 to-transparent"
          aria-hidden="true"
        />
        <div
          className="absolute inset-0 bg-gradient-to-r from-primary/20 via-transparent to-transparent"
          aria-hidden="true"
        />
      </div>
    </section>
  );
}
