import { useEffect, useState } from "react";
import { authApi } from "../api/auth";
import { useAuthStore } from "../store/authStore";
import { authStyles } from "../styles/auth.styles";

function AuthCallbackPage({ onNavigate }) {
  const [status, setStatus] = useState("processing");
  const [error, setError] = useState(null);
  const { setUser } = useAuthStore();

  useEffect(() => {
    const handleCallback = async () => {
      try {
        const urlParams = new URLSearchParams(window.location.search);
        const token = urlParams.get("token");
        const errorParam = urlParams.get("error");

        if (errorParam) {
          setStatus("error");
          setError(getErrorMessage(errorParam));
          return;
        }

        if (!token) {
          setStatus("error");
          setError("No authentication token received");
          return;
        }

        authApi.setToken(token);

        const user = await authApi.getCurrentUser();

        if (user) {
          setUser(user);
          setStatus("success");
          setTimeout(() => {
            onNavigate("chat");
          }, 1500);
        } else {
          setStatus("error");
          setError("Failed to get user information");
        }
      } catch (err) {
        console.error("Auth callback error:", err);
        setStatus("error");
        setError("Authentication failed. Please try again.");
      }
    };

    handleCallback();
  }, [setUser, onNavigate]);

  const getErrorMessage = (errorCode) => {
    switch (errorCode) {
      case "access_denied":
        return "Access was denied. Please try again.";
      case "missing_code":
        return "Authorization code is missing.";
      case "auth_failed":
        return "Authentication failed. Please try again.";
      default:
        return "An error occurred during authentication.";
    }
  };

  return (
    <div className={authStyles.page}>
      <div className={authStyles.card}>
        <div className="text-center">
          {status === "processing" && (
            <>
              <div className="w-12 h-12 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
              <h2 className="text-xl font-semibold text-white mb-2">
                Signing you in...
              </h2>
              <p className="text-slate-400">
                Please wait while we complete your authentication.
              </p>
            </>
          )}

          {status === "success" && (
            <>
              <div className="w-12 h-12 bg-emerald-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="24"
                  height="24"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="text-emerald-400"
                >
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              </div>
              <h2 className="text-xl font-semibold text-white mb-2">
                Welcome!
              </h2>
              <p className="text-slate-400">
                You have been signed in successfully. Redirecting...
              </p>
            </>
          )}

          {status === "error" && (
            <>
              <div className="w-12 h-12 bg-red-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="24"
                  height="24"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="text-red-400"
                >
                  <circle cx="12" cy="12" r="10" />
                  <line x1="15" x2="9" y1="9" y2="15" />
                  <line x1="9" x2="15" y1="9" y2="15" />
                </svg>
              </div>
              <h2 className="text-xl font-semibold text-white mb-2">
                Authentication Failed
              </h2>
              <p className="text-slate-400 mb-6">{error}</p>
              <button
                onClick={() => onNavigate("login")}
                className={authStyles.backButton}
              >
                Try Again
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default AuthCallbackPage;
