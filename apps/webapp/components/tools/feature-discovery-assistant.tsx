/* eslint-disable jsx-a11y/label-has-associated-control -- customComponent doc examples don't work :( */

'use client';

import ModelSelector from '@/components/feature-selector/model-selector';
import { useGlobalContext } from '@/components/provider/global-provider';
import { Button } from '@/components/shadcn/button';
import { SearchExplanationsResponse } from '@/lib/utils/general';
import {
  SteerFeature,
  STEER_TEMPERATURE,
  STEER_FREQUENCY_PENALTY,
  STEER_SEED,
  STEER_STRENGTH_MULTIPLIER,
  STEER_SPECIAL_TOKENS,
  ChatMessage as SteerChatMessage, // Renaming to avoid conflict with local ChatMessage
} from '@/lib/utils/steer';
import { callSteerChatApi } from '@/lib/utils/steer-api'; // Import the new utility
// import { ExplanationWithPartialRelations } from '@/prisma/generated/zod'; // No longer directly used in this component's props/state
import { useState, useCallback } from 'react';

// Define a type for our structured feature suggestion
type SuggestedSteerFeature = SteerFeature & {
  originalExplanation: string; // To show the source explanation
  score?: number; // Placeholder for potential future sorting/relevance score
  isSelected: boolean; // To manage selection state
};

// Define FeatureSteeringResult type
// This should extend SuggestedSteerFeature to include steering-specific results
type FeatureSteeringResult = SuggestedSteerFeature & {
  steeredText?: string;
  steeringError?: string;
  isSteeringLoading?: boolean;
};

// Example prompts for better onboarding
const EXAMPLE_PROMPTS = [
  {
    prompt: "Write a story about a lonely robot",
    feature: "social isolation",
    description: "Test how isolation-related features affect creative writing"
  },
  {
    prompt: "Explain why exercise is important",
    feature: "positive sentiment",
    description: "See how positivity features influence health advice"
  },
  {
    prompt: "Debug this Python function",
    feature: "code generation",
    description: "Explore programming-related feature effects"
  },
  {
    prompt: "Describe a sunset over the ocean",
    feature: "visual imagery",
    description: "Test features related to descriptive language"
  }
];

export default function FeatureDiscoveryAssistant() {
  const { getDefaultModel, getInferenceEnabledModels, showToastServerError } = useGlobalContext();
  const [modelId, setModelId] = useState<string>(getDefaultModel()?.id || '');
  const [testPrompt, setTestPrompt] = useState<string>('');
  const [featureQuery, setFeatureQuery] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(false); // For the main search
  const [suggestedFeatures, setSuggestedFeatures] = useState<SuggestedSteerFeature[]>([]);
  // steeringResults will store the outcome for each of the 5 suggestedFeatures
  const [steeringResults, setSteeringResults] = useState<FeatureSteeringResult[]>([]);
  const [hasSteered, setHasSteered] = useState<boolean>(false); // Tracks if "Steer Selected Features" has been clicked

  const [showExamples, setShowExamples] = useState<boolean>(false);
  const [baselineText, setBaselineText] = useState<string>(''); // Store unsteered baseline
  const [isGettingBaseline, setIsGettingBaseline] = useState<boolean>(false);


  const handleSearch = async () => {
    setHasSteered(false);

    if (!modelId || !testPrompt.trim() || !featureQuery.trim()) {
      console.warn('Please select a model, enter a test prompt, and enter a feature name to search.');
      return;
    }
    setIsLoading(true);
    setSuggestedFeatures([]);
    setSteeringResults([]);
    // setHasSteered(false); // Already reset above

    try {
      const response = await fetch('/api/explanation/search-model', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: featureQuery, modelId, offset: 0 }),
      });

      if (!response.ok) throw new Error(`API Error: ${response.status} ${response.statusText}`);
      const data = (await response.json()) as SearchExplanationsResponse; // Type assertion for data

      if (data.results && data.results.length > 0) {
        const topResults = data.results.slice(0, 5);
        const formattedFeatures: SuggestedSteerFeature[] = topResults.map((exp, index) => {
          const { neuron } = exp; // exp is an ExplanationWithPartialRelations here
          if (!neuron || !neuron.index) {
            console.warn('Explanation result missing neuron data:', exp); return null;
          }
          return {
            modelId: neuron.modelId,
            layer: neuron.layer,
            index: parseInt(neuron.index, 10),
            explanation: `Feature related to: "${exp.description}" (Original model: ${neuron.modelId}, Layer: ${neuron.layer}, Index: ${neuron.index})`,
            strength: neuron.maxActApprox || 1,
            originalExplanation: exp.description,
            isSelected: index < 2, // Default select top 2
          };
        }).filter(Boolean) as SuggestedSteerFeature[];
        setSuggestedFeatures(formattedFeatures);

        // Initialize steeringResults for all 5 discovered features
        const initialSteeringData: FeatureSteeringResult[] = formattedFeatures.map(feature => ({
          ...feature,
          isSteeringLoading: false, // Not loading initially
          steeredText: undefined,
          steeringError: undefined,
        }));
        setSteeringResults(initialSteeringData);

      } else {
        alert('No features found for your query.');
      }
    } catch (error) {
      console.error('Failed to search features:', error);
      showToastServerError();
      alert(`Failed to search features. ${error instanceof Error ? error.message : 'Please check console for details.'}`);
    } finally {
      setIsLoading(false);
    }
  };

  // Function to get baseline (unsteered) output
  const getBaselineOutput = async () => {
    if (!modelId || !testPrompt.trim()) return;

    setIsGettingBaseline(true);
    try {
      const modelToSteer = (modelId !== 'gemma-2-2b') ? modelId : 'gemma-2-2b-it';
      const baselineData = await callSteerChatApi({
        modelId: modelToSteer,
        defaultChatMessages: [{ role: 'user', content: testPrompt }] as SteerChatMessage[],
        steeredChatMessages: [{ role: 'user', content: testPrompt }] as SteerChatMessage[],
        features: [], // No features for baseline
        temperature: STEER_TEMPERATURE,
        nTokens: 96,
        freqPenalty: STEER_FREQUENCY_PENALTY,
        seed: STEER_SEED,
        strengthMultiplier: STEER_STRENGTH_MULTIPLIER,
        steerSpecialTokens: STEER_SPECIAL_TOKENS,
      });
      const baselineMessage = baselineData?.DEFAULT?.chatTemplate?.findLast(msg => msg.role === 'model')?.content;
      setBaselineText(baselineMessage || 'No baseline response.');
    } catch (error) {
      console.error('Failed to get baseline:', error);
      setBaselineText('Failed to get baseline output.');
    } finally {
      setIsGettingBaseline(false);
    }
  };

  const handleSteerSelectedFeatures = useCallback(async () => {
    const selectedForSteering = suggestedFeatures.filter(f => f.isSelected);
    if (selectedForSteering.length === 0) {
      alert('Please select at least one feature to steer.');
      return;
    }
    setHasSteered(true);

    // Set loading state only for selected features in the main steeringResults array
    setSteeringResults(prevGlobalResults =>
      prevGlobalResults.map(res => {
        const isSelectedForThisOperation = selectedForSteering.some(
          sf => sf.modelId === res.modelId && sf.layer === res.layer && sf.index === res.index
        );
        return isSelectedForThisOperation
          ? { ...res, isSteeringLoading: true, steeredText: undefined, steeringError: undefined }
          : res;
      })
    );

    const steeringPromises = selectedForSteering.map(async (featureToSteer): Promise<FeatureSteeringResult> => {
      try {
        const apiFeature = {
          modelId: featureToSteer.modelId,
          layer: featureToSteer.layer,
          index: featureToSteer.index,
          strength: (featureToSteer.strength || 1) * 1.5,
          explanation: featureToSteer.explanation,
        };
        const modelToSteer = (modelId !== 'gemma-2-2b') ? modelId : 'gemma-2-2b-it';
        const steeringData = await callSteerChatApi({
          modelId: modelToSteer,
          defaultChatMessages: [{ role: 'user', content: testPrompt }] as SteerChatMessage[],
          steeredChatMessages: [{ role: 'user', content: testPrompt }] as SteerChatMessage[],
          features: [apiFeature],
          temperature: STEER_TEMPERATURE, nTokens: 96, freqPenalty: STEER_FREQUENCY_PENALTY,
          seed: STEER_SEED, strengthMultiplier: STEER_STRENGTH_MULTIPLIER, steerSpecialTokens: STEER_SPECIAL_TOKENS,
        });
        const assistantMessage = steeringData?.STEERED?.chatTemplate?.findLast(msg => msg.role === 'model')?.content;
        return { ...featureToSteer, steeredText: assistantMessage || 'No response text.', steeringError: undefined, isSteeringLoading: false };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Steering request failed';
        return { ...featureToSteer, steeredText: undefined, steeringError: errorMessage, isSteeringLoading: false };
      }
    });

    const settledResults = await Promise.allSettled(steeringPromises);

    const updatedResultsFromPromises: FeatureSteeringResult[] = settledResults.map((settledResult, index) => {
      if (settledResult.status === 'fulfilled') {
        return settledResult.value;
      }
      const { reason } = settledResult;
      console.error('Unexpected promise rejection post-settled:', reason);
      const errorMessage = reason instanceof Error ? reason.message : String(reason);
      const originalFeatureForRejection = selectedForSteering[index];
      return {
        ...originalFeatureForRejection,
        steeredText: undefined,
        steeringError: `Unexpected error: ${errorMessage}`,
        isSteeringLoading: false,
      };
    });

    setSteeringResults(prevGlobalResults =>
      prevGlobalResults.map(existingGlobalFeatureResult => {
        const newlySteeredData = updatedResultsFromPromises.find(
          nr => nr.modelId === existingGlobalFeatureResult.modelId &&
            nr.layer === existingGlobalFeatureResult.layer &&
            nr.index === existingGlobalFeatureResult.index
        );
        if (newlySteeredData) {
          return {
            ...existingGlobalFeatureResult,
            ...newlySteeredData,
            isSteeringLoading: false,
          };
        }
        return existingGlobalFeatureResult;
      })
    );
  }, [suggestedFeatures, modelId, testPrompt, showToastServerError]);


  const handleCheckboxChange = (changedIndex: number) => {
    setSuggestedFeatures(prevFeatures =>
      prevFeatures.map((feature, idx) =>
        idx === changedIndex ? { ...feature, isSelected: !feature.isSelected } : feature
      )
    );
  };

  return (
    <div className="m-auto flex max-w-7xl flex-col gap-6 rounded-lg border py-6 px-4 sm:px-6 lg:px-8 shadow">
      <div className="flex justify-between items-start">
        <div>
          <h1 className="text-xl font-semibold text-slate-700">Feature Discovery Assistant</h1>
          <p className="text-sm text-slate-500 mt-1">Discover and test how specific features affect model outputs</p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setShowExamples(!showExamples)}
        >
          {showExamples ? 'Hide' : 'Show'} Examples
        </Button>
      </div>

      {/* Example prompts section */}
      {showExamples && (
        <div className="bg-gradient-to-br from-emerald-50 to-blue-50 rounded-lg p-6 mb-6 border border-emerald-200">
          <div className="flex items-center mb-4">
            <svg className="w-5 h-5 text-emerald-600 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
            </svg>
            <h3 className="text-lg font-semibold text-emerald-800">Quick Start Examples</h3>
          </div>
          <p className="text-sm text-slate-600 mb-4">Click any example to automatically fill in the fields and get started:</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {EXAMPLE_PROMPTS.map((example, idx) => (
              <button
                type="button"
                key={idx}
                onClick={() => {
                  setTestPrompt(example.prompt);
                  setFeatureQuery(example.feature);
                  setShowExamples(false);
                }}
                className="text-left p-4 bg-white rounded-lg border border-emerald-200 hover:border-emerald-400 hover:shadow-md transition-all duration-200 group"
              >
                <div className="flex items-start">
                  <div className="flex-shrink-0 w-8 h-8 bg-emerald-100 rounded-full flex items-center justify-center mr-3 group-hover:bg-emerald-200 transition-colors">
                    <span className="text-emerald-600 font-bold text-sm">{idx + 1}</span>
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-medium text-slate-800 mb-1">&quot;{example.prompt}&quot;</p>
                    <p className="text-xs text-emerald-700 font-medium mb-1">→ Feature: {example.feature}</p>
                    <p className="text-xs text-slate-500">{example.description}</p>
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Progress Steps */}
      <div className="flex items-center justify-center mb-6">
        <div className="flex items-center space-x-8">
          <div className="flex items-center">
            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium ${modelId ? 'bg-emerald-500 text-white' : 'bg-slate-200 text-slate-600'}`}>
              1
            </div>
            <span className="ml-2 text-sm font-medium text-slate-700">Model</span>
          </div>
          <div className={`h-0.5 w-16 ${modelId ? 'bg-emerald-300' : 'bg-slate-200'}`} />
          <div className="flex items-center">
            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium ${testPrompt.trim() ? 'bg-emerald-500 text-white' : 'bg-slate-200 text-slate-600'}`}>
              2
            </div>
            <span className="ml-2 text-sm font-medium text-slate-700">Prompt</span>
          </div>
          <div className={`h-0.5 w-16 ${testPrompt.trim() ? 'bg-emerald-300' : 'bg-slate-200'}`} />
          <div className="flex items-center">
            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium ${featureQuery.trim() ? 'bg-emerald-500 text-white' : 'bg-slate-200 text-slate-600'}`}>
              3
            </div>
            <span className="ml-2 text-sm font-medium text-slate-700">Feature</span>
          </div>
        </div>
      </div>

      {/* Inputs Section */}
      <div className="space-y-6">
        <div className="bg-slate-50 rounded-lg p-4">
          <label htmlFor='featureDiscoveryModelSelector' className="block text-sm font-medium text-slate-700 mb-2">
            <span className="inline-flex items-center">
              <span className="bg-emerald-100 text-emerald-700 rounded-full w-6 h-6 flex items-center justify-center text-xs font-bold mr-2">1</span>
              Select Target Model
            </span>
          </label>
          <ModelSelector
            id="featureDiscoveryModelSelector"
            modelId={modelId}
            modelIdChangedCallback={(newModelId) => {
              setModelId(newModelId);
              setSuggestedFeatures([]);
              setSteeringResults([]);
              setHasSteered(false);
              setTestPrompt('');
              setFeatureQuery('');
            }}
            overrideModels={getInferenceEnabledModels()}
          />
        </div>

        <div className={`bg-slate-50 rounded-lg p-4 transition-opacity ${!modelId ? 'opacity-50' : ''}`}>
          <label htmlFor="test-prompt-fda" className="block text-sm font-medium text-slate-700 mb-2">
            <span className="inline-flex items-center">
              <span className="bg-emerald-100 text-emerald-700 rounded-full w-6 h-6 flex items-center justify-center text-xs font-bold mr-2">2</span>
              Enter Test Prompt
            </span>
          </label>
          <input
            type="text"
            id="test-prompt-fda"
            placeholder="e.g., Write a story about friendship, Explain quantum physics, Debug this code..."
            value={testPrompt}
            onChange={(e) => setTestPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !isLoading && modelId && testPrompt.trim() && featureQuery.trim()) {
                handleSearch();
              }
            }}
            disabled={!modelId}
            className="w-full h-12 rounded-md border border-slate-300 bg-white px-4 py-3 text-sm placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 disabled:cursor-not-allowed disabled:opacity-50 disabled:bg-slate-100"
          />
          <p className="text-xs text-slate-500 mt-2">The prompt that will be used to test how features affect the model&apos;s output</p>
        </div>

        <div className={`bg-slate-50 rounded-lg p-4 transition-opacity ${!testPrompt.trim() ? 'opacity-50' : ''}`}>
          <label htmlFor="feature-name-fda" className="block text-sm font-medium text-slate-700 mb-2">
            <span className="inline-flex items-center">
              <span className="bg-emerald-100 text-emerald-700 rounded-full w-6 h-6 flex items-center justify-center text-xs font-bold mr-2">3</span>
              Enter Desired Feature Name
            </span>
          </label>
          <input
            type="text"
            id="feature-name-fda"
            placeholder="e.g., social isolation, positive sentiment, code generation, visual imagery..."
            value={featureQuery}
            onChange={(e) => setFeatureQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !isLoading && modelId && testPrompt.trim() && featureQuery.trim()) {
                handleSearch();
              }
            }}
            disabled={!testPrompt.trim()}
            className="w-full h-12 rounded-md border border-slate-300 bg-white px-4 py-3 text-sm placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 disabled:cursor-not-allowed disabled:opacity-50 disabled:bg-slate-100"
          />
          <p className="text-xs text-slate-500 mt-2">Describe the type of behavior or concept you want to find features for</p>
        </div>
      </div>

      <div className="flex justify-center mt-8">
        <Button
          onClick={handleSearch}
          disabled={isLoading || !modelId || !testPrompt.trim() || !featureQuery.trim()}
          size="lg"
          className="bg-gradient-to-r from-emerald-600 to-emerald-700 hover:from-emerald-700 hover:to-emerald-800 text-white shadow-lg hover:shadow-xl transition-all duration-200 px-8 py-4 text-base font-semibold"
        >
          {isLoading ? (
            <>
              <span className="animate-spin inline-block w-5 h-5 border-2 border-white border-t-transparent rounded-full mr-3" />
              Searching for Features...
            </>
          ) : (
            <>
              <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              Find Top 5 Matching Features
            </>
          )}
        </Button>
      </div>


      {/* Baseline output section */}
      {testPrompt && modelId && (
        <div className="border border-slate-200 rounded-lg p-4">
          <div className="flex justify-between items-center mb-2">
            <h3 className="text-sm font-medium text-slate-700">Baseline Output (No Steering)</h3>
            <Button
              size="sm"
              variant="outline"
              onClick={getBaselineOutput}
              disabled={isGettingBaseline}
            >
              {isGettingBaseline ? 'Getting...' : 'Get Baseline'}
            </Button>
          </div>
          {baselineText && (
            <pre className="text-xs bg-slate-50 p-3 rounded overflow-x-auto whitespace-pre-wrap">
              {baselineText}
            </pre>
          )}
        </div>
      )}

      {/* Discovered Features Section */}
      {suggestedFeatures.length > 0 && (
        <div className="mt-4">
          <div className="flex justify-between items-center mb-3">
            <h2 className="text-lg font-medium text-slate-600">Discovered Features:</h2>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setSuggestedFeatures(features => features.map(f => ({ ...f, isSelected: true })));
                }}
              >
                Select All
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setSuggestedFeatures(features => features.map(f => ({ ...f, isSelected: false })));
                }}
              >
                Clear All
              </Button>
            </div>
          </div>
          <div className="mt-2 flex flex-row flex-wrap -mx-2">
            {suggestedFeatures.map((feature, idx) => {
              const steeringResultForCard = steeringResults.find(
                sr => sr.modelId === feature.modelId && sr.layer === feature.layer && sr.index === feature.index
              );

              const cardClasses = [
                "w-full sm:w-1/2 lg:w-1/3 xl:w-1/5 p-2 mb-4 rounded-md shadow-sm transition-all duration-300 ease-in-out",
              ];
              if (feature.isSelected) {
                cardClasses.push("bg-emerald-50 border-2 border-emerald-300");
              } else {
                cardClasses.push("bg-slate-50 border-2 border-transparent");
              }
              if (hasSteered && !feature.isSelected) {
                cardClasses.push("opacity-60");
              }

              return (
                <div key={`feature-${feature.modelId}-${feature.layer}-${feature.index}`} className={cardClasses.join(' ')}>
                  <div className="flex items-center justify-between">
                    <h3 className="mb-1 font-semibold text-emerald-700">Feature #{idx + 1}</h3>
                    <input
                      type="checkbox"
                      id={`feature-checkbox-${idx}`}
                      checked={feature.isSelected}
                      onChange={() => handleCheckboxChange(idx)}
                      className="form-checkbox h-5 w-5 text-emerald-600 transition duration-150 ease-in-out"
                    />
                  </div>
                  <p className="mb-1 text-sm text-slate-600">
                    Derived from: &quot;{feature.originalExplanation}&quot;
                  </p>
                  <p className="mb-2 text-xs text-slate-500">
                    modelId: &apos;{feature.modelId}&apos;, layer: &apos;{feature.layer}&apos;, index: {feature.index}, strength: {feature.strength}
                  </p>

                  {/* Steering Result Display within Card */}
                  {steeringResultForCard && (steeringResultForCard.isSteeringLoading || (hasSteered && feature.isSelected)) && (
                    <div className="mt-3 border-t border-slate-200 pt-3">
                      {steeringResultForCard.isSteeringLoading ? (
                        <div className="flex items-center">
                          <span className="animate-spin inline-block w-3 h-3 border-2 border-emerald-500 border-t-transparent rounded-full mr-2" />
                          <p className="text-sm text-slate-500">Steering...</p>
                        </div>
                      ) : steeringResultForCard.steeringError ? (
                        <div className="rounded-md bg-red-100 p-2">
                          <p className="text-sm font-medium text-red-700">Steering Error:</p>
                          <p className="text-xs text-red-600">{steeringResultForCard.steeringError}</p>
                        </div>
                      ) : steeringResultForCard.steeredText ? (
                        <div className="rounded-md bg-green-50 p-2">
                          <p className="text-sm font-medium text-green-700">Steered Output:</p>
                          <pre className="overflow-x-auto whitespace-pre-wrap rounded bg-green-100 p-1.5 text-xs text-green-800">{steeringResultForCard.steeredText}</pre>
                        </div>
                      ) : (hasSteered && feature.isSelected) ? (
                        <p className="text-sm text-slate-500">Steering completed, but no text was returned.</p>
                      ) : null}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <p className="mt-2 text-xs text-slate-500">
            Select features and click &quot;Steer Selected Features&quot; to test their effect.
          </p>
        </div>
      )}

      {/* "Steer Selected Features" Button */}
      {suggestedFeatures.length > 0 && (
        <Button
          onClick={handleSteerSelectedFeatures}
          disabled={isLoading || suggestedFeatures.every(f => !f.isSelected) || steeringResults.some(sr => sr.isSteeringLoading)}
          className="mt-4"
        >
          {steeringResults.some(sr => sr.isSteeringLoading) ? (
            <>
              <span className="animate-spin inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full mr-2" />
              Steering...
            </>
          ) : (
            'Steer Selected Features'
          )}
        </Button>
      )}

      {/* Export Features Button */}
      {suggestedFeatures.length > 0 && (
        <div className="mt-4 flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              const exportData = {
                model: modelId,
                prompt: testPrompt,
                query: featureQuery,
                features: suggestedFeatures.map(f => ({
                  modelId: f.modelId,
                  layer: f.layer,
                  index: f.index,
                  strength: f.strength,
                  explanation: f.originalExplanation,
                  selected: f.isSelected,
                  steeredOutput: steeringResults.find(sr =>
                    sr.modelId === f.modelId && sr.layer === f.layer && sr.index === f.index
                  )?.steeredText
                })),
                baseline: baselineText
              };
              const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = url;
              a.download = `feature-discovery-${new Date().toISOString().split('T')[0]}.json`;
              document.body.appendChild(a);
              a.click();
              document.body.removeChild(a);
              URL.revokeObjectURL(url);
            }}
          >
            Export Results (JSON)
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              const selectedFeatures = suggestedFeatures.filter(f => f.isSelected);
              const text = selectedFeatures.map(f =>
                `${f.modelId}:${f.layer}:${f.index}`
              ).join(',');
              navigator.clipboard.writeText(text);
              alert('Feature coordinates copied to clipboard!');
            }}
          >
            Copy Feature IDs
          </Button>
        </div>
      )}
    </div>
  );
}
