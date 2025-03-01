TURN THESE INTO PACKAGE.JSON scripts!

`rm -rf ../packages/python/neuronpedia-autointerp-client && openapi-generator-cli generate -i openapi/autointerp-server.yaml -g python -o ../packages/python/neuronpedia-autointerp-client --package-name neuronpedia_autointerp_client`

`rm -rf ../packages/typescript/neuronpedia-autointerp-client && openapi-generator-cli generate -i openapi/autointerp-server.yaml -g typescript-fetch -o ../packages/typescript/neuronpedia-autointerp-client -p npmName=neuronpedia-autointerp-client`
from packages/typescript/neuronpedia/autointerp-client: `npm link`
from webapp: `npm link ../../packages/typescript/neuronpedia-autointerp-client`

inference server development
after updating schema, run this to update the python inference client
FROM SCHEMAS DIR
`rm -rf ../packages/python/neuronpedia-inference-client && openapi-generator-cli generate -i openapi/inference-server.yaml -g python -o ../packages/python/neuronpedia-inference-client --package-name neuronpedia_inference_client --additional-properties=packageVersion=1.1.0`
then go to /apps/inference and run this to pick up the changes
`poetry remove neuronpedia-inference-client && poetry add ../../packages/python/neuronpedia-inference-client`
then publish the inf-client:
go to packages/python/neuronpedia-inference-client
`do the publish to pypi`
switch back inf server to prod dependency
go to apps/inference and run this
`poetry remove neuronpedia-inference-client && poetry install neuronpedia-inference-client`
publish the inference server?
for typescrsipt:

`rm -rf ../packages/typescript/neuronpedia-inference-client && openapi-generator-cli generate -i openapi/inference-server.yaml -g typescript-fetch -o ../packages/typescript/neuronpedia-inference-client -p npmName=neuronpedia-inference-client`
from packages/typescript/neuronpedia/inference-client: `npm link`
webapp
`npm link ../../packages/typescript/neuronpedia-inference-client`

for autointerp dev
`pip install -e ../../packages/python/neuronpedia-autointerp-client`

distributing python clients
`python -m build`
`python -m twine upload dist/*`

distributing npm clients
`npm publish`
