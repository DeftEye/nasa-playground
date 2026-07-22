import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';

/**
 * UserMenu — top-right user menu with a Logout action
 * (architecture §6 / VAL-FE-AUTH-011).
 *
 * Logout: clears `localStorage.auth_token`, sets `user = null` in context,
 * and redirects to `/login` via React Router (no token in the URL —
 * VAL-FE-AUTH-012). After logout, any protected route visit stays on
 * `/login` because `user === null`.
 *
 * The menu is a simple dropdown toggled by a button; closes on outside
 * click or Escape.
 */
export function UserMenu() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  function handleLogout() {
    logout();
    setOpen(false);
    navigate('/login', { replace: true });
  }

  if (!user) return null;

  const initial = user.email.charAt(0).toUpperCase() || '?';

  return (
    <div className="relative" ref={menuRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="User menu"
        className="flex h-9 w-9 items-center justify-center rounded-full bg-blue-600 text-sm font-semibold text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
      >
        {initial}
      </button>
      {open && (
        <div
          role="menu"
          aria-label="User menu"
          className="absolute right-0 mt-2 w-56 overflow-hidden rounded-md border border-gray-200 bg-white shadow-lg dark:border-gray-700 dark:bg-gray-800"
        >
          <div className="border-b border-gray-100 px-4 py-3 dark:border-gray-700">
            <p className="truncate text-sm font-medium text-gray-900 dark:text-gray-100">
              {user.email}
            </p>
          </div>
          <button
            type="button"
            role="menuitem"
            onClick={handleLogout}
            className="block w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-700"
          >
            Logout
          </button>
        </div>
      )}
    </div>
  );
}
