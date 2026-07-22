import { useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';

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
 * `location.state.from`) or `/` (VAL-FE-AUTH-004, 009).
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
      // Navigate to the originally-requested path or `/`. `replace` so the
      // `/login` entry isn't left in history (clean back button).
      navigate(from && from !== '/login' ? from : '/', { replace: true });
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
  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4 dark:bg-gray-900">
      <div className="w-full max-w-md">
        <div className="mb-6 text-center">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
            NASA Sky Tracker
          </h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Sign in to your account
          </p>
        </div>
        <form
          onSubmit={handleSubmit}
          noValidate
          className="space-y-4 rounded-lg border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-700 dark:bg-gray-800"
          aria-label="Login form"
        >
          <div>
            <label
              htmlFor="login-email"
              className="block text-sm font-medium text-gray-700 dark:text-gray-300"
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
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-gray-900 placeholder-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
              placeholder="you@example.com"
            />
            {fieldErrors.email && (
              <p
                id="login-email-error"
                role="alert"
                className="mt-1 text-sm text-red-600 dark:text-red-400"
              >
                {fieldErrors.email}
              </p>
            )}
          </div>
          <div>
            <label
              htmlFor="login-password"
              className="block text-sm font-medium text-gray-700 dark:text-gray-300"
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
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-gray-900 placeholder-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
              placeholder="••••••••"
            />
            {fieldErrors.password && (
              <p
                id="login-password-error"
                role="alert"
                className="mt-1 text-sm text-red-600 dark:text-red-400"
              >
                {fieldErrors.password}
              </p>
            )}
          </div>
          {submitError && (
            <p
              role="alert"
              className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-900/30 dark:text-red-300"
              data-testid="login-submit-error"
            >
              {submitError}
            </p>
          )}
          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting ? 'Signing in…' : 'Sign in'}
          </button>
          <p className="text-center text-sm text-gray-500 dark:text-gray-400">
            Don&apos;t have an account?{' '}
            <Link
              to="/register"
              className="font-medium text-blue-600 hover:text-blue-500 dark:text-blue-400"
            >
              Register
            </Link>
          </p>
        </form>
      </div>
    </div>
  );
}
