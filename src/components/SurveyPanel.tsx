import { useState, useMemo } from 'react';
import type React from 'react';
import type { Gender, PopulationGroup, UserProfile } from '../types';
import { useT } from '../lib/language';

interface Props {
  onComplete: (profile: UserProfile) => void;
  /** 'scanning' shows the in-progress hint; 'report' shows a compact header */
  context?: 'scanning' | 'report';
}

type Step = 'gender' | 'population';

const GENDER_ICONS: Record<string, React.ReactNode> = {
  female: (
    <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="9" r="5" />
      <line x1="12" y1="14" x2="12" y2="21" />
      <line x1="9" y1="18" x2="15" y2="18" />
    </svg>
  ),
  male: (
    <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="10" cy="14" r="5" />
      <line x1="14" y1="10" x2="20" y2="4" />
      <polyline points="16,4 20,4 20,8" />
    </svg>
  ),
};

export default function SurveyPanel({ onComplete, context: _context = 'scanning' }: Props) {
  const t = useT();
  const [step, setStep] = useState<Step>('gender');
  const [gender, setGender] = useState<Gender | null>(null);
  const [population, setPopulation] = useState<PopulationGroup>('default');

  const GENDER_OPTIONS = useMemo<{ value: Gender; label: string }[]>(() => [
    { value: 'female', label: t('survey.female') },
    { value: 'male', label: t('survey.male') },
  ], [t]);

  const POPULATION_OPTIONS = useMemo<{ value: PopulationGroup; label: string; description: string }[]>(() => [
    { value: 'default', label: t('survey.universal'), description: t('survey.universalDesc') },
    { value: 'east_asian', label: t('survey.asian'), description: t('survey.asianDesc') },
  ], [t]);

  function handleGenderSelect(g: Gender) {
    setGender(g);
    setTimeout(() => setStep('population'), 200);
  }

  function handlePopulationSelect(p: PopulationGroup) {
    setPopulation(p);
    setTimeout(() => onComplete({ gender, population: p, procedures: [], hasProcedures: false }), 200);
  }

  const backBtn = (to: Step) => (
    <button
      onClick={() => setStep(to)}
      className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600 font-sans mb-3 transition-colors"
    >
      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
      </svg>
      {t('survey.back')}
    </button>
  );

  return (
    <div className="w-full">
      {/* Step 1: Gender */}
      {step === 'gender' && (
        <div className="animate-fade-in bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
          <p className="text-sm font-semibold text-gray-800 mb-3 font-sans">
            {t('survey.gender')}
          </p>
          <div className="flex gap-2">
            {GENDER_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => handleGenderSelect(opt.value)}
                className={`flex-1 flex flex-col items-center gap-1 py-3 px-2 rounded-xl border-2 text-xs font-sans font-medium transition-all duration-150 ${
                  gender === opt.value
                    ? 'border-amber-400 bg-amber-50 text-amber-700'
                    : 'border-gray-200 bg-gray-50 text-gray-600 hover:border-amber-300 hover:bg-amber-50/50'
                }`}
              >
                {GENDER_ICONS[opt.value]}
                <span>{opt.label}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Step 1.5: Population norms */}
      {step === 'population' && (
        <div className="animate-fade-in bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
          {backBtn('gender')}
          <p className="text-sm font-semibold text-gray-800 mb-1 font-sans">
            {t('survey.populationTitle')}
          </p>
          <p className="text-xs text-gray-400 font-sans mb-3">
            {t('survey.populationHint')}
          </p>
          <div className="flex flex-col gap-2">
            {POPULATION_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => handlePopulationSelect(opt.value)}
                className={`flex items-center gap-3 px-4 py-3 rounded-xl border-2 text-left transition-all duration-150 ${
                  population === opt.value
                    ? 'border-amber-400 bg-amber-50'
                    : 'border-gray-200 bg-gray-50 hover:border-amber-300 hover:bg-amber-50/50'
                }`}
              >
                <div>
                  <p className={`text-sm font-sans font-medium ${population === opt.value ? 'text-amber-700' : 'text-gray-700'}`}>
                    {opt.label}
                  </p>
                  <p className="text-[10px] font-sans text-gray-400 mt-0.5">{opt.description}</p>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

    </div>
  );
}
