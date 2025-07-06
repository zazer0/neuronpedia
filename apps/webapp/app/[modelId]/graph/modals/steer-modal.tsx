import CustomTooltip from '@/components/custom-tooltip';
import { useGraphModalContext } from '@/components/provider/graph-modal-provider';
import { useGraphContext } from '@/components/provider/graph-provider';
import { Button } from '@/components/shadcn/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/shadcn/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/shadcn/dialog';
import { LoadingSquare } from '@/components/svg/loading-square';
import { SteerLogitsRequest, SteerResponse, SteerResponseLogitsByToken } from '@/lib/utils/graph';
import {
  STEER_N_COMPLETION_TOKENS_MAX,
  STEER_N_COMPLETION_TOKENS_MAX_THINKING,
  STEER_SEED,
  STEER_STRENGTH_MAX,
  STEER_STRENGTH_MIN,
  STEER_TEMPERATURE_MAX,
} from '@/lib/utils/steer';
import * as Checkbox from '@radix-ui/react-checkbox';
import * as Slider from '@radix-ui/react-slider';
import { Check, Joystick, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import * as yup from 'yup';
import {
  ANT_MODEL_ID_TO_NEURONPEDIA_MODEL_ID,
  CLTGraph,
  CLTGraphNode,
  getIndexFromAnthropicFeatureId,
  getLayerFromAnthropicFeatureId,
  nodeTypeHasFeatureDetail,
} from '../utils';

export const SteerLogitFeatureSchema = yup.object({
  layer: yup.number().required('Layer is required'),
  index: yup.number().required('Index is required'),
  position: yup.number().default(-1), // -1 = last position
  ablate: yup.boolean().default(false),
  delta: yup.number().nullable(),
});

export type SteerLogitFeature = yup.InferType<typeof SteerLogitFeatureSchema>;

function TokenTooltip({ logitsByToken }: { logitsByToken: SteerResponseLogitsByToken }) {
  return (
    <div className="flex flex-wrap items-end gap-x-0 gap-y-[0px]">
      {logitsByToken.map((token, index) => {
        if (token.top_logits.length === 0) {
          return (
            <span
              key={`${token.token}-${index}`}
              className="cursor-default py-[3px] font-mono text-[11px] text-slate-800"
            >
              {token.token.toString().replaceAll(' ', '\u00A0').replaceAll('\n', '↵')}
            </span>
          );
        }
        return (
          <CustomTooltip
            key={`${token.token}-${index}`}
            trigger={
              <span
                className={`cursor-pointer rounded px-[3px] py-[3px] font-mono text-[11px] text-slate-800 transition-all ${
                  token.top_logits.length === 0 ? 'bg-slate-100' : 'ml-[3px] bg-sky-100 hover:bg-sky-200'
                }`}
              >
                {token.token.toString().replaceAll(' ', '\u00A0').replaceAll('\n', '↵')}
              </span>
            }
          >
            {token.top_logits.length === 0 ? (
              <div>{token.token.toString().replaceAll(' ', '\u00A0').replaceAll('\n', '↵')}</div>
            ) : (
              <div className="flex w-full min-w-[160px] flex-col gap-y-0.5">
                <div className="mb-2 flex flex-row justify-between gap-x-3 border-b border-slate-300 pb-1">
                  <span className="text-xs text-slate-500">Token</span>
                  <span className="text-xs text-slate-500">Probability</span>
                </div>
                {token.top_logits.map((logit) => (
                  <div key={logit.token} className="flex flex-row items-center justify-between gap-x-1 font-mono">
                    <span className="rounded bg-slate-200 px-[3px] py-[2px] text-[11px] text-slate-700">
                      {logit.token.toString().replaceAll(' ', '\u00A0').replaceAll('\n', '↵')}
                    </span>
                    <span className="text-[11px] text-slate-600">{logit.prob.toFixed(2)}</span>
                  </div>
                ))}
              </div>
            )}
          </CustomTooltip>
        );
      })}
    </div>
  );
}

function NodeToSteer({
  node,
  label,
  selectedGraph,
  steerLogitFeatures,
  setSteerLogitFeatures,
}: {
  node: CLTGraphNode;
  label: string;
  selectedGraph: CLTGraph;
  steerLogitFeatures: SteerLogitFeature[];
  setSteerLogitFeatures: (features: SteerLogitFeature[]) => void;
}) {
  function findSelectedFeature(layer: number, index: number) {
    return steerLogitFeatures.find((f) => f.layer === layer && f.index === index);
  }

  const layer = getLayerFromAnthropicFeatureId(
    // @ts-ignore
    ANT_MODEL_ID_TO_NEURONPEDIA_MODEL_ID[selectedGraph?.metadata.scan],
    node.feature,
  );
  const index = getIndexFromAnthropicFeatureId(
    // @ts-ignore
    ANT_MODEL_ID_TO_NEURONPEDIA_MODEL_ID[selectedGraph?.metadata.scan],
    node.feature,
  );

  const lastPosition = selectedGraph.metadata.prompt_tokens.length - 1;

  function setFeatureStrength(feature: SteerLogitFeature | undefined, strength: number) {
    if (!feature) {
      // add it to the array
      setSteerLogitFeatures([
        ...steerLogitFeatures,
        { layer, index, delta: strength, position: lastPosition, ablate: false },
      ]);
      return;
    }
    setSteerLogitFeatures(
      steerLogitFeatures.map((f) =>
        f.layer === feature.layer && f.index === feature.index
          ? { ...f, delta: strength, ablate: false, position: lastPosition }
          : f,
      ),
    );
  }

  return (
    <div key={node.nodeId} className="flex flex-col gap-y-1">
      <div className="flex flex-row items-center gap-x-1 text-[10px]">
        <div className="flex flex-1 basis-1/2 flex-col gap-y-1">
          <div className="flex flex-row gap-x-1.5 pt-0.5 font-mono text-[8px] leading-none text-slate-500">
            L{layer} {index}
          </div>
          <div className="line-clamp-1 flex-1 pb-[1px] text-[11px] leading-none" title={label}>
            {label}
          </div>
        </div>
        <div className="mt-0.5 flex w-full basis-1/2 flex-row items-center gap-x-3 px-3 text-sky-700">
          <label
            className="flex select-none flex-row items-center gap-x-[5px] text-[11px] font-medium uppercase leading-none text-sky-700"
            htmlFor={`ablate-${layer}-${index}`}
          >
            <Checkbox.Root
              name={`ablate-${layer}-${index}`}
              id={`ablate-${layer}-${index}`}
              className="flex h-4 w-4 appearance-none items-center justify-center rounded-[3px] border border-sky-700 bg-white outline-none"
              defaultChecked
              checked={findSelectedFeature(layer, index)?.ablate || false}
              onCheckedChange={(e) => {
                if (e === true) {
                  alert('Warning: Ablation is not working properly.');
                }
                const newAblateState = e === true;
                const foundSelectedFeature = findSelectedFeature(layer, index);
                if (foundSelectedFeature) {
                  if (newAblateState) {
                    setSteerLogitFeatures(
                      steerLogitFeatures.map((f) =>
                        f.layer === layer && f.index === index ? { ...f, ablate: newAblateState, delta: null } : f,
                      ),
                    );
                  }
                  // not ablating, remove it
                  else {
                    setSteerLogitFeatures(steerLogitFeatures.filter((f) => f.layer !== layer && f.index !== index));
                  }
                } else {
                  setSteerLogitFeatures([
                    ...steerLogitFeatures,
                    { layer, index, delta: null, position: lastPosition, ablate: newAblateState },
                  ]);
                }
              }}
            >
              <Checkbox.Indicator className="text-sky-700">
                <Check className="h-4 w-4" />
              </Checkbox.Indicator>
            </Checkbox.Root>
            Ablate
          </label>
          {/* <input
          type="number"
          value={findSelectedFeature(layer, index)?.delta || 0}
          onChange={(e) => {
            const value = parseFloat(e.target.value);
            if (!Number.isNaN(value)) {
              const clampedValue = Math.min(Math.max(value, STEER_STRENGTH_MIN), STEER_STRENGTH_MAX);
              setFeatureStrength(findSelectedFeature(layer, index), clampedValue);
            }
          }}
          className="mr-1 hidden h-5 w-8 rounded border border-sky-600 px-0.5 py-0.5 text-center text-[10px] font-medium leading-none text-sky-700 ring-0 focus:border-sky-700 sm:block"
        /> */}
          {/* <ChevronsDown className="mt-0 h-3 w-3" /> */}
          <Slider.Root
            defaultValue={[findSelectedFeature(layer, index)?.delta || 0]}
            min={STEER_STRENGTH_MIN}
            max={STEER_STRENGTH_MAX}
            step={5}
            value={[findSelectedFeature(layer, index)?.delta || 0]}
            onValueChange={(value) => {
              if (value[0] === 0) {
                setSteerLogitFeatures(steerLogitFeatures.filter((f) => f.layer !== layer && f.index !== index));
                return;
              }
              setFeatureStrength(findSelectedFeature(layer, index), value[0]);
            }}
            disabled={findSelectedFeature(layer, index)?.ablate}
            className={`group relative flex h-5 w-full items-center ${
              findSelectedFeature(layer, index)?.ablate
                ? 'pointer-events-none cursor-not-allowed opacity-50 grayscale'
                : 'cursor-pointer'
            }`}
          >
            <Slider.Track className="relative h-[8px] grow rounded-full border border-sky-600 bg-white disabled:border-slate-300 disabled:bg-slate-100 group-hover:bg-sky-50">
              <Slider.Range className="absolute h-full rounded-full bg-sky-600 disabled:bg-slate-300 group-hover:bg-sky-700" />
              <div className="mx-auto mt-[7px] h-[8px] w-[1px] bg-sky-600 disabled:bg-slate-300" />
            </Slider.Track>
            <Slider.Thumb className="flex h-5 w-8 items-center justify-center rounded-full border border-sky-700 bg-white text-[10px] font-medium text-sky-700 shadow disabled:border-slate-300 disabled:bg-slate-100 group-hover:bg-sky-100">
              {findSelectedFeature(layer, index)?.delta || '0'}
            </Slider.Thumb>
          </Slider.Root>
          <Button
            variant="ghost"
            size="sm"
            className={`-ml-1.5 flex h-6 w-6 min-w-6 rounded p-0 text-red-700 hover:bg-red-100 ${
              findSelectedFeature(layer, index) ? 'text-red-700 hover:bg-red-100' : 'text-slate-400'
            }`}
            disabled={!findSelectedFeature(layer, index)}
            onClick={() =>
              setSteerLogitFeatures(steerLogitFeatures.filter((f) => f.layer !== layer && f.index !== index))
            }
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
          {/* <ChevronsUp className="mt-0 h-3 w-3" /> */}
        </div>
      </div>
      {findSelectedFeature(layer, index) && (
        <div className="mb-1 mt-0.5 flex flex-wrap items-end gap-x-0 gap-y-[3px]">
          {selectedGraph?.metadata.prompt_tokens.map((token, i) => (
            // eslint-disable-next-line
            <span
              key={i}
              className={`mr-[3px] cursor-pointer rounded px-[3px] py-[1px] font-mono text-[10px] text-slate-800 transition-all ${
                findSelectedFeature(layer, index)?.position === i
                  ? 'bg-sky-300 text-sky-900 hover:bg-sky-200'
                  : 'bg-slate-300 hover:bg-sky-100'
              }`}
              onClick={() => {
                alert('Oops, this is not finished yet. You currently can only steer on the last token, sorry!');
              }}
            >
              {token.toString().replaceAll(' ', '\u00A0').replaceAll('\n', '↵')}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

export default function SteerModal() {
  const { isSteerModalOpen, setIsSteerModalOpen } = useGraphModalContext();
  const { visState, selectedMetadataGraph, selectedGraph, getOverrideClerpForNode } = useGraphContext();
  const [steerResult, setSteerResult] = useState<SteerResponse | undefined>();
  const [isSteering, setIsSteering] = useState(false);
  const [steerLogitFeatures, setSteerLogitFeatures] = useState<SteerLogitFeature[]>([]);
  const [steerTokens, setSteerTokens] = useState(10);
  const [temperature, setTemperature] = useState(0.7);
  const [thinking] = useState(false);
  const [freqPenalty, setFreqPenalty] = useState(0);
  const [seed, setSeed] = useState(STEER_SEED);
  const [randomSeed, setRandomSeed] = useState(true);
  const [freezeAttention, setFreezeAttention] = useState(false);

  useEffect(() => {
    // reset everything when selected graph changes
    setSteerResult(undefined);
    setIsSteering(false);
    setSteerLogitFeatures([]);
    setSteerTokens(10);
    setTemperature(0.7);
    setFreqPenalty(0);
    setSeed(STEER_SEED);
    setRandomSeed(true);
    setFreezeAttention(false);
  }, [selectedGraph]);

  return (
    <Dialog open={isSteerModalOpen} onOpenChange={setIsSteerModalOpen}>
      <DialogContent className="flex h-[90vh] max-h-[90vh] min-h-[90vh] w-full max-w-[92vw] flex-col overflow-hidden bg-slate-50 pt-4">
        <DialogHeader className="flex w-full flex-col items-center justify-center">
          <DialogTitle className="flex w-full flex-row items-center justify-center text-base text-slate-700">
            <Joystick className="mr-1.5 h-5 w-5" /> Steer/Intervention Mode (Beta)
          </DialogTitle>
          <div className="text-xs text-red-500">
            Warning: This is in beta and not expected to be accurate. Please use extreme caution.
          </div>
        </DialogHeader>
        <div className="h-full max-h-full overflow-y-hidden">
          {selectedGraph ? (
            <div className="flex h-full max-h-full w-full flex-row gap-x-4 gap-y-1">
              <div className="flex h-full max-h-full basis-1/2 flex-col gap-y-1 px-0.5 pb-0.5 text-xs">
                <Card className="flex h-full max-h-full w-full flex-col bg-white">
                  <CardHeader className="sticky top-0 z-10 flex w-full flex-row items-center justify-between rounded-t-xl bg-white pb-3 pt-4">
                    <CardTitle>Features to Steer</CardTitle>
                    <Button
                      onClick={() => {
                        alert(
                          "Oops, this isn't ready yet. Sorry! For now you can only steer features that you have pinned.",
                        );
                      }}
                      size="sm"
                      variant="outline"
                    >
                      + Add Feature
                    </Button>
                  </CardHeader>
                  <CardContent className="h-full overflow-y-scroll px-5">
                    {/* <div className="text-slate-500">{JSON.stringify(steerLogitFeatures)}</div> */}
                    {/* <div>Features to Steer</div> */}
                    {visState.supernodes.length > 0 &&
                      visState.supernodes.map((supernode) => {
                        if (supernode.length === 0) {
                          return null;
                        }
                        return (
                          <div key={supernode.join('-')} className="mb-2 rounded-md bg-slate-100 px-3 py-3">
                            <div className="mb-1.5 flex flex-row gap-x-1.5">
                              {supernode[0]} <span className="text-[8px] text-slate-400">SUPERNODE</span>
                            </div>
                            <div className="flex flex-col gap-y-1.5 pl-2">
                              {supernode.slice(1).map((id) => {
                                const node = selectedGraph?.nodes.find((n) => n.nodeId === id);
                                if (!node || !nodeTypeHasFeatureDetail(node)) {
                                  return null;
                                }
                                return (
                                  <NodeToSteer
                                    key={id}
                                    node={node}
                                    label={getOverrideClerpForNode(node) || ''}
                                    selectedGraph={selectedGraph}
                                    steerLogitFeatures={steerLogitFeatures}
                                    setSteerLogitFeatures={setSteerLogitFeatures}
                                  />
                                );
                              })}
                            </div>
                          </div>
                        );
                      })}

                    {visState.pinnedIds.length > 0 && (
                      <div className="flex flex-col gap-y-1.5">
                        <div className="rounded-md bg-slate-100 px-3 py-3">
                          <div className="mb-1.5 flex flex-row gap-x-1.5 pb-1 text-[10px] uppercase leading-none text-slate-400">
                            Not In Supernode Group
                          </div>
                          <div className="flex flex-col gap-y-1.5 pl-2">
                            {visState.pinnedIds.map((id) => {
                              // find the node and ensure it has a feature detail
                              const node = selectedGraph?.nodes.find((n) => n.nodeId === id);
                              if (!node || !nodeTypeHasFeatureDetail(node)) {
                                return null;
                              }
                              // check if it's in a supernode
                              const supernode = visState.supernodes.find((sn) => sn.includes(id));
                              if (supernode) {
                                return null;
                              }
                              //   // check if any previous pinnedId by index has the same feature
                              //   const previousSameFeatureNode = visState.pinnedIds.slice(0, index).find((id2) => {
                              //     const node2 = selectedGraph?.nodes.find((n) => n.nodeId === id2);
                              //     return node2 && node2.feature === node.feature;
                              //   });
                              //   if (previousSameFeatureNode) {
                              //     return null;
                              //   }
                              return (
                                <NodeToSteer
                                  key={id}
                                  node={node}
                                  label={getOverrideClerpForNode(node) || ''}
                                  selectedGraph={selectedGraph}
                                  steerLogitFeatures={steerLogitFeatures}
                                  setSteerLogitFeatures={setSteerLogitFeatures}
                                />
                              );
                            })}
                          </div>
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>
              <div className="flex basis-1/2 flex-col gap-y-4 pb-0.5 pr-0.5">
                {/* <div className="text-xs text-slate-700">Select tokens to steer</div> */}
                <Card className="flex w-full flex-col bg-white">
                  <CardHeader className="sticky top-0 z-10 flex w-full flex-row items-center justify-between rounded-t-xl bg-white pb-3 pt-6">
                    <CardTitle>Settings & Steer</CardTitle>
                  </CardHeader>
                  <CardContent className="flex h-full flex-col justify-center px-5">
                    <div className="mt-2 grid w-full grid-cols-3 items-center justify-center gap-x-1 gap-y-1.5">
                      <div className="flex w-full flex-row items-center justify-start gap-x-3">
                        <div className="w-[70px] text-right text-[10px] font-medium uppercase leading-tight text-slate-400">
                          Tokens
                        </div>
                        <input
                          type="number"
                          onChange={(e) => {
                            if (
                              parseInt(e.target.value, 10) >
                              (thinking ? STEER_N_COMPLETION_TOKENS_MAX_THINKING : STEER_N_COMPLETION_TOKENS_MAX)
                            ) {
                              alert(
                                `Due to compute constraints, the current allowed max tokens is: ${
                                  thinking ? STEER_N_COMPLETION_TOKENS_MAX_THINKING : STEER_N_COMPLETION_TOKENS_MAX
                                }`,
                              );
                            } else {
                              setSteerTokens(parseInt(e.target.value, 10));
                            }
                          }}
                          className="max-w-[80px] flex-1 rounded-md border-slate-300 py-1 text-center text-xs text-slate-700"
                          value={steerTokens}
                        />
                      </div>
                      <div className="flex w-full flex-row items-center justify-start gap-x-3">
                        <div className="w-[70px] text-right text-[10px] font-medium uppercase leading-tight text-slate-400">
                          Temp
                        </div>
                        <input
                          type="number"
                          onChange={(e) => {
                            if (parseFloat(e.target.value) > STEER_TEMPERATURE_MAX || parseFloat(e.target.value) < 0) {
                              alert(`Temperature must be >= 0 and <= ${STEER_TEMPERATURE_MAX}`);
                            } else {
                              setTemperature(parseFloat(e.target.value));
                            }
                          }}
                          className="max-w-[80px] flex-1 rounded-md border-slate-300 py-1 text-center text-xs text-slate-700"
                          value={temperature}
                        />
                      </div>
                      <div className="flex w-full flex-row items-center justify-start gap-x-3">
                        <div className="w-[70px] text-right text-[10px] font-medium uppercase leading-tight text-slate-400">
                          Freq Penalty
                        </div>
                        <input
                          type="number"
                          onChange={(e) => {
                            if (parseFloat(e.target.value) > 2 || parseFloat(e.target.value) < -2) {
                              alert('Freq penalty must be >= -2 and <= 2');
                            } else {
                              setFreqPenalty(parseFloat(e.target.value));
                            }
                          }}
                          className="max-w-[80px] flex-1 rounded-md border-slate-300 py-1 text-center text-xs text-slate-700"
                          value={freqPenalty}
                        />
                      </div>
                      <div className="col-span-1 flex w-full flex-row items-center justify-start gap-x-3">
                        <div className="w-[70px] text-right text-[10px] font-medium uppercase leading-tight text-slate-400">
                          Manual Seed
                        </div>
                        <input
                          type="number"
                          disabled={randomSeed}
                          onChange={(e) => {
                            if (parseInt(e.target.value, 10) > 100000000 || parseInt(e.target.value, 10) < -100000000) {
                              alert('Seed must be >= -100000000 and <= 100000000');
                            } else {
                              setSeed(parseInt(e.target.value, 10));
                            }
                          }}
                          className="max-w-[80px] flex-1 rounded-md border-slate-300 py-1 text-center text-xs text-slate-700 disabled:bg-slate-200 disabled:text-slate-400"
                          value={seed}
                        />
                      </div>
                      <div className="col-span-1 flex w-full flex-row items-center justify-start gap-x-3">
                        <div className="w-[70px] text-right text-[10px] font-medium uppercase leading-tight text-slate-400">
                          Random Seed
                        </div>
                        <input
                          onChange={(e) => {
                            setRandomSeed(e.target.checked);
                            setSeed(STEER_SEED);
                          }}
                          type="checkbox"
                          checked={randomSeed}
                          className="h-5 w-5 cursor-pointer rounded border-slate-300 bg-slate-100 py-1 text-center text-xs text-slate-700 checked:bg-slate-500"
                        />
                      </div>
                      <div className="col-span-1 flex w-full flex-row items-center justify-start gap-x-3">
                        <div className="w-[70px] text-right text-[10px] font-medium uppercase leading-tight text-slate-400">
                          Freeze Attn
                        </div>
                        <input
                          onChange={(e) => {
                            setFreezeAttention(e.target.checked);
                          }}
                          type="checkbox"
                          checked={freezeAttention}
                          className="h-5 w-5 cursor-pointer rounded border-slate-300 bg-slate-100 py-1 text-center text-xs text-slate-700 checked:bg-slate-500"
                        />
                      </div>
                    </div>
                    <Button
                      variant="emerald"
                      className="mt-5 flex w-36 flex-row gap-x-1.5 self-center text-xs font-bold uppercase"
                      onClick={() => {
                        if (steerLogitFeatures.length === 0) {
                          alert('Please set at least one feature to steer on the left.');
                          return;
                        }
                        setIsSteering(true);
                        setSteerResult(undefined);
                        // TODO: remove <bos> hack
                        const requestBody: SteerLogitsRequest = {
                          modelId: selectedGraph?.metadata.scan,
                          prompt: selectedGraph?.metadata.prompt.replaceAll('<bos>', '') || '',
                          features: steerLogitFeatures,
                          nTokens: steerTokens,
                          topK: 5,
                          freezeAttention,
                        };

                        // Make the API request
                        fetch('/api/steer-logits', {
                          method: 'POST',
                          headers: {
                            'Content-Type': 'application/json',
                          },
                          body: JSON.stringify(requestBody),
                        })
                          .then((response) => response.json())
                          .then((data: SteerResponse) => {
                            setSteerResult(data);
                            setIsSteering(false);
                          })
                          .catch((error) => {
                            console.error('Error steering logits:', error);
                            setIsSteering(false);
                          });
                      }}
                    >
                      <Joystick className="h-4 w-4" />
                      Steer
                    </Button>
                  </CardContent>
                </Card>
                <Card className="flex h-full w-full flex-col bg-white">
                  <CardHeader className="sticky top-0 z-10 flex w-full flex-row items-center justify-between rounded-t-xl bg-white pb-3 pt-5">
                    <CardTitle>Results</CardTitle>
                  </CardHeader>
                  <CardContent className="flex h-full max-h-full flex-col px-6">
                    <div className="flex-1">
                      <div className="mb-1.5 mt-3 text-xs font-bold uppercase text-slate-400">Prompt</div>
                      <div className="flex flex-wrap items-end gap-x-0 gap-y-[3px]">
                        {selectedMetadataGraph?.promptTokens.map((token, index) => (
                          <span key={index} className="py-[3px] font-mono text-[11px] text-slate-800">
                            {token.toString().replaceAll(' ', '\u00A0').replaceAll('\n', '↵').replaceAll('<bos>', '')}
                          </span>
                        ))}
                      </div>
                    </div>
                    <div className="flex-1">
                      <div className="mb-1.5 mt-3 text-xs font-bold uppercase text-slate-400">Default</div>
                      {steerResult ? (
                        <TokenTooltip logitsByToken={steerResult.DEFAULT_LOGITS_BY_TOKEN} />
                      ) : isSteering ? (
                        <div className="h-10">
                          <LoadingSquare className="h-5 w-5" />
                        </div>
                      ) : (
                        <div className="mt-3 w-full text-xs text-slate-400">
                          Click Steer to generate the default completion.
                        </div>
                      )}
                    </div>
                    <div className="flex-1">
                      <div className="mb-1.5 mt-3 text-xs font-bold uppercase text-slate-400">Steered</div>
                      {steerResult ? (
                        <TokenTooltip logitsByToken={steerResult.STEERED_LOGITS_BY_TOKEN} />
                      ) : isSteering ? (
                        <div className="h-10">
                          <LoadingSquare className="h-5 w-5" />
                        </div>
                      ) : (
                        <div className="mt-3 w-full text-xs text-slate-400">
                          Click Steer to generate the steered completion.
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              </div>
            </div>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
