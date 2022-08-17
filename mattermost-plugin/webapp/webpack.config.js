// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.
const exec = require('child_process').exec;

const path = require('path');

const webpack = require('webpack');
const {ModuleFederationPlugin} = require('webpack').container;

const tsTransformer = require('@formatjs/ts-transformer');

const PLUGIN_ID = require('../plugin.json').id;

const packageJson = require('./package.json');

const NPM_TARGET = process.env.npm_lifecycle_event; //eslint-disable-line no-process-env
const TARGET_IS_PRODUCT = NPM_TARGET === 'start:product' || NPM_TARGET === 'build:product';

let mode = 'production';
let devtool;
const plugins = [];
if (NPM_TARGET === 'debug' || NPM_TARGET === 'debug:watch' || NPM_TARGET === 'start:product') {
    mode = 'development';
    devtool = 'source-map';
    plugins.push(
        new webpack.DefinePlugin({
            'process.env.NODE_ENV': JSON.stringify('development'),
        }),
    );
}

if (NPM_TARGET === 'build:watch' || NPM_TARGET === 'debug:watch' || NPM_TARGET === 'live-watch') {
    plugins.push({
        apply: (compiler) => {
            compiler.hooks.watchRun.tap('WatchStartPlugin', () => {
                // eslint-disable-next-line no-console
                console.log('Change detected. Rebuilding webapp.');
            });
            compiler.hooks.afterEmit.tap('AfterEmitPlugin', () => {
                let command = 'cd .. && make deploy-from-watch';
                if (NPM_TARGET === 'live-watch') {
                    command = 'cd .. && make deploy-to-mattermost-directory';
                }
                exec(command, (err, stdout, stderr) => {
                    if (stdout) {
                        process.stdout.write(stdout);
                    }
                    if (stderr) {
                        process.stderr.write(stderr);
                    }
                });
            });
        },
    });
}

const config = {
    entry: TARGET_IS_PRODUCT ? './src/remote_entry.ts' : './src/plugin_entry.ts',
    resolve: {
        modules: [
            'src',
            'node_modules',
            path.resolve(__dirname),
        ],
        alias: {
            moment: path.resolve(__dirname, '../../webapp/node_modules/moment/'),
        },
        extensions: ['*', '.js', '.jsx', '.ts', '.tsx'],
    },
    module: {
        rules: [
            {
                test: /\.tsx?$/,
                use: {
                    loader: 'ts-loader',
                    options: {
                        getCustomTransformers: {
                            before: [
                                tsTransformer.transform({
                                    overrideIdFn: '[sha512:contenthash:base64:6]',
                                    ast: true,
                                }),
                            ],
                        },
                    },
                },
                exclude: [/node_modules/],

            },
            {
                test: /\.html$/,
                type: 'asset/resource',
            },
            {
                test: /\.s[ac]ss$/i,
                use: [
                    'style-loader',
                    'css-loader',
                    'sass-loader',
                    path.resolve(__dirname, 'loaders/globalScssClassLoader'),
                ],
            },
            {
                test: /\.css$/i,
                use: [
                    'style-loader',
                    'css-loader',
                ],
            },
            {
                test: /\.(tsx?|js|jsx|mjs|html)$/,
                use: [
                ],
                exclude: [/node_modules/],
            },
            {
                test: /\.(png|eot|tiff|svg|woff2|woff|ttf|jpg|gif)$/,
                type: 'asset/resource',
                generator: {
                    filename: 'static/[name].[ext]',
                }
            },
        ],
    },
    devtool,
    mode,
    plugins,
};

if (TARGET_IS_PRODUCT) {
    function makeSingletonSharedModules(packageNames) {
        const sharedObject = {};

        for (const packageName of packageNames) {
            const version = packageJson.dependencies[packageName];

            sharedObject[packageName] = {
                requiredVersion: version,
                singleton: true,
                version,
            };
        }

        return sharedObject;
    }

    config.plugins.push(new ModuleFederationPlugin({
        name: PLUGIN_ID,
        filename: 'remote_entry.js',
        exposes: {
            '.': './src/index',

            // This probably won't need to be exposed in the long run, but its a POC for exposing multiple modules
            './manifest': './src/manifest',
        },
        shared: [
            '@mattermost/client',
            'prop-types',

            makeSingletonSharedModules([
                'react',
                'react-dom',
                'react-intl',
                'react-redux',
                'react-router-dom',
            ]),
        ],
    }));

    config.plugins.push(new webpack.DefinePlugin({
        'process.env.TARGET_IS_PRODUCT': TARGET_IS_PRODUCT, // TODO We might want a better name for this
    }));
} else {
    config.resolve.alias['react-intl'] = path.resolve(__dirname, '../../webapp/node_modules/react-intl/');

    config.outputs = {
        devtoolNamespace: PLUGIN_ID,
        path: path.join(__dirname, '/dist'),
        publicPath: '/',
        filename: 'main.js',
    };
}

const env = {};
env.RUDDER_KEY = JSON.stringify(process.env.RUDDER_KEY || ''); //eslint-disable-line no-process-env
env.RUDDER_DATAPLANE_URL = JSON.stringify(process.env.RUDDER_DATAPLANE_URL || ''); //eslint-disable-line no-process-env

config.plugins.push(new webpack.DefinePlugin({
    'process.env': env,
}));

if (NPM_TARGET === 'start:product') {
    config.devServer = {
        port: 9006,
        devMiddleware: {
            writeToDisk: false,
        },
    };
}

module.exports = config;
