import { useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { ThemeToggle } from '../components/ThemeToggle';

/**
 * Login page (architecture §6 / VAL-FE-AUTH-001..004, 008).
 *
 * Email + password form with client-side field validation:
 * - empty fields → field-level errors, no API call (VAL-FE-AUTH-001)
 * - invalid email format → field error, no API call (VAL-FE-AUTH-002)
 * - password < 8 chars → field error, no API call
 *
 * On submit with valid fields: POST /api/auth/login. A 401 surfaces as a
 * single inline error (no toast spam — VAL-FE-AUTH-003). On success, the
 * JWT is stored by AuthProvider and the browser navigates to the
 * originally-requested path (preserved by ProtectedRoute in
 * `location.state.from`) or `/dashboard` (VAL-FE-AUTH-004, 009 /
 * VAL-ROUTING-003, 005).
 *
 * The token is never placed in the URL (VAL-FE-AUTH-012).
 */
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PASSWORD_MIN = 8;

interface FieldErrors {
  email?: string;
  password?: string;
}

export function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  // ProtectedRoute stores the originally-requested location here so we can
  // return the user there after a successful login.
  const from = (location.state as { from?: { pathname: string } } | null)
    ?.from?.pathname;

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function validate(): FieldErrors {
    const errs: FieldErrors = {};
    if (!email.trim()) {
      errs.email = 'Email is required.';
    } else if (!EMAIL_REGEX.test(email.trim())) {
      errs.email = 'Enter a valid email address.';
    }
    if (!password) {
      errs.password = 'Password is required.';
    } else if (password.length < PASSWORD_MIN) {
      errs.password = `Password must be at least ${PASSWORD_MIN} characters.`;
    }
    return errs;
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitError(null);
    const errs = validate();
    setFieldErrors(errs);
    if (Object.keys(errs).length > 0) {
      // Field-level validation prevents the API call.
      return;
    }
    setSubmitting(true);
    try {
      await login(email.trim(), password);
      // Navigate to the originally-requested path or `/dashboard`. `replace`
      // so the `/login` entry isn't left in history (clean back button).
      navigate(from && from !== '/login' ? from : '/dashboard', { replace: true });
    } catch (err) {
      const status =
        (err as { response?: { status?: number } }).response?.status ?? 0;
      if (status === 401) {
        // Generic message — no user enumeration (matches backend's
        // "Invalid credentials").
        setSubmitError('Invalid email or password.');
      } else {
        setSubmitError('Something went wrong. Please try again.');
      }
    } finally {
      setSubmitting(false);
    }
  }

  // PublicOnlyRoute redirects already-authenticated users away from
  // `/login`, so this component only renders for unauthenticated users.
  //
  // Restyle note (m14-auth-surfaces-restyle): only classes/wrappers were
  // changed to apply the dark cosmic theme. The global cosmic background
  // (deep-space gradient + starfield) is set on `body` in `index.css`, so
  // this page intentionally does NOT set its own opaque background — the
  // cosmic backdrop reads through. All field labels, validation/error copy,
  // the `login-submit-error` testid, and the form behavior are preserved.
  return (
    <div className="relative flex min-h-screen items-center justify-center px-4 py-10">
      {/* Public theme toggle (M17 / VAL-THEME-011). Absolutely positioned
          top-right so the centered form copy/testids/CTAs are undisturbed. */}
      <div className="absolute right-4 top-4">
        <ThemeToggle />
      </div>
      <div className="w-full max-w-md">
        <div className="mb-6 text-center">
          <h1 className="font-display text-2xl font-bold tracking-tight text-star-white">
            NASA Sky Tracker
          </h1>
          <p className="mt-1 text-sm text-muted">
            Sign in to your account
          </p>
        </div>
        <form
          onSubmit={handleSubmit}
          noValidate
          className="card-cosmic space-y-4 p-6"
          aria-label="Login form"
        >
          <div>
            <label
              htmlFor="login-email"
              className="mb-1 block text-sm font-medium text-star-white"
            >
              Email
            </label>
            <input
              id="login-email"
              name="email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                if (fieldErrors.email)
                  setFieldErrors((p) => ({ ...p, email: undefined }));
              }}
              aria-invalid={Boolean(fieldErrors.email)}
              aria-describedby={fieldErrors.email ? 'login-email-error' : undefined}
              className="input-cosmic"
              placeholder="you@example.com"
            />
            {fieldErrors.email && (
              <p
                id="login-email-error"
                role="alert"
                className="field-error"
              >
                {fieldErrors.email}
              </p>
            )}
          </div>
          <div>
            <label
              htmlFor="login-password"
              className="mb-1 block text-sm font-medium text-star-white"
            >
              Password
            </label>
            <input
              id="login-password"
              name="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                if (fieldErrors.password)
                  setFieldErrors((p) => ({ ...p, password: undefined }));
              }}
              aria-invalid={Boolean(fieldErrors.password)}
              aria-describedby={
                fieldErrors.password ? 'login-password-error' : undefined
              }
              className="input-cosmic"
              placeholder="••••••••"
            />
            {fieldErrors.password && (
              <p
                id="login-password-error"
                role="alert"
                className="field-error"
              >
                {fieldErrors.password}
              </p>
            )}
          </div>
          {submitError && (
            <p
              role="alert"
              className="rounded-md border border-cosmic-error/30 bg-cosmic-error/10 px-3 py-2 text-sm text-cosmic-error"
              data-testid="login-submit-error"
            >
              {submitError}
            </p>
          )}
          <button
            type="submit"
            disabled={submitting}
            className="btn-primary w-full"
          >
            {submitting ? 'Signing in…' : 'Sign in'}
          </button>
          <p className="text-center text-sm text-muted">
            Don&apos;t have an account?{' '}
            <Link
              to="/register"
              className="font-medium text-nebula-purple-soft hover:text-star-white transition-colors"
            >
              Register
            </Link>
          </p>
        </form>
      </div>
    </div>
  );
}
