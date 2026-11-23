module.exports = {
    webpack: {
        configure: (config) => {
            // Excalidraw ships ESM that imports "roughjs/bin/rough" without the extension.
            // Allow extensionless resolution, for @excalidraw packages only.
            config.module.rules.push({
                test: /\.m?js$/,
                include: /node_modules[\\/]@excalidraw/,
                resolve: { fullySpecified: false },
            });

            // Silence the harmless "Failed to parse source map" warnings from node_modules.
            config.ignoreWarnings = [
                ...(config.ignoreWarnings || []),
                /Failed to parse source map/,
            ];
            return config;
        },
    },
};