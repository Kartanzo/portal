import React, { Component, ErrorInfo, ReactNode } from 'react';

interface Props {
    children?: ReactNode;
}

interface State {
    hasError: boolean;
    error: Error | null;
}

class ErrorBoundary extends Component<Props, State> {
    public state: State = {
        hasError: false,
        error: null
    };

    public static getDerivedStateFromError(error: Error): State {
        return { hasError: true, error };
    }

    public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
        console.error("Uncaught error:", error, errorInfo);
    }

    public render() {
        if (this.state.hasError) {
            return (
                <div style={{ padding: '2rem', textAlign: 'center', fontFamily: 'sans-serif' }}>
                    <h1 style={{ color: '#dc2626', marginBottom: '1rem' }}>Algo deu errado</h1>
                    <p style={{ marginBottom: '1rem' }}>Ocorreu um erro inesperado na aplicação.</p>
                    <div style={{
                        backgroundColor: '#f3f4f6',
                        padding: '1rem',
                        borderRadius: '0.5rem',
                        textAlign: 'left',
                        overflow: 'auto',
                        fontSize: '0.875rem',
                        marginBottom: '1rem',
                        maxWidth: '800px',
                        margin: '0 auto 1rem'
                    }}>
                        <pre>{this.state.error && this.state.error.toString()}</pre>
                    </div>
                    <button
                        style={{
                            backgroundColor: '#2563eb',
                            color: 'white',
                            padding: '0.5rem 1rem',
                            borderRadius: '0.25rem',
                            border: 'none',
                            cursor: 'pointer'
                        }}
                        onClick={() => window.location.reload()}
                    >
                        Recarregar Página
                    </button>
                </div>
            );
        }

        return this.props.children;
    }
}

export default ErrorBoundary;
