import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { ThemeToggle } from '../components/ThemeToggle';

/**
 * Register page (architecture §6 / VAL-FE-AUTH-005..008).
 *
 * Email + password form with the same field-level validation as Login
 * (empty fields, invalid email, password < 8 chars → field errors, no API
 * call — VAL-FE-AUTH-005).
 *
 * On submit with valid fields:
 * 1. POST /api/auth/register (201 on success).
 * 2. POST /api/auth/login (auto-login) → store JWT.
 * 3. Redirect to `/dashboard` (VAL-FE-AUTH-007 / VAL-ROUTING-003).
 *
 * A 409/conflict from register surfaces as an inline error referencing the
 * conflict (VAL-FE-AUTH-006). The token never enters the URL
 * (VAL-FE-AUTH-012).
 */
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PASSWORD_MIN = 8;

interface FieldErrors {
  email?: string;
  password?: string;
}

export function Register() {
  const { register } = useAuth();
  const navigate = useNavigate();

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
      await register(email.trim(), password);
      // Register always redirects to `/dashboard` (architecture §6 /
      // VAL-ROUTING-003).
      navigate('/dashboard', { replace: true });
    } catch (err) {
      const status =
        (err as { response?: { status?: number } }).response?.status ?? 0;
      if (status === 409) {
        setSubmitError('This email is already registered. Try logging in.');
      } else if (status === 401) {
        // M5 polish: register succeeded (201) but the auto-login call
        // returned 401. Surface a distinct message so the user knows their
        // account was created and they should try signing in manually.
        setSubmitError(
          'Account created, but automatic sign-in failed. Please log in.',
        );
      } else {
        setSubmitError('Something went wrong. Please try again.');
      }
    } finally {
      setSubmitting(false);
    }
  }

  // PublicOnlyRoute redirects already-authenticated users away from
  // `/register`, so this component only renders for unauthenticated users.
  //
  // Restyle note (m14-auth-surfaces-restyle): only classes/wrappers were
  // changed to apply the dark cosmic theme. The global cosmic background
  // (deep-space gradient + starfield) is set on `body` in `index.css`, so
  // this page intentionally does NOT set its own opaque background — the
  // cosmic backdrop reads through. All field labels, validation/error copy,
  // the `register-submit-error` testid, and the form behavior are preserved.
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
            Create a new account
          </p>
        </div>
        <form
          onSubmit={handleSubmit}
          noValidate
          className="card-cosmic space-y-4 p-6"
          aria-label="Register form"
        >
          <div>
            <label
              htmlFor="register-email"
              className="mb-1 block text-sm font-medium text-star-white"
            >
              Email
            </label>
            <input
              id="register-email"
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
              aria-describedby={
                fieldErrors.email ? 'register-email-error' : undefined
              }
              className="input-cosmic"
              placeholder="you@example.com"
            />
            {fieldErrors.email && (
              <p
                id="register-email-error"
                role="alert"
                className="field-error"
              >
                {fieldErrors.email}
              </p>
            )}
          </div>
          <div>
            <label
              htmlFor="register-password"
              className="mb-1 block text-sm font-medium text-star-white"
            >
              Password
            </label>
            <input
              id="register-password"
              name="password"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                if (fieldErrors.password)
                  setFieldErrors((p) => ({ ...p, password: undefined }));
              }}
              aria-invalid={Boolean(fieldErrors.password)}
              aria-describedby={
                fieldErrors.password ? 'register-password-error' : undefined
              }
              className="input-cosmic"
              placeholder="At least 8 characters"
            />
            {fieldErrors.password && (
              <p
                id="register-password-error"
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
              data-testid="register-submit-error"
            >
              {submitError}
            </p>
          )}
          <button
            type="submit"
            disabled={submitting}
            className="btn-primary w-full"
          >
            {submitting ? 'Creating account…' : 'Create account'}
          </button>
          <p className="text-center text-sm text-muted">
            Already have an account?{' '}
            <Link
              to="/login"
              className="font-medium text-nebula-purple-soft hover:text-star-white transition-colors"
            >
              Sign in
            </Link>
          </p>
        </form>
      </div>
    </div>
  );
}
