import type {ReactNode} from 'react';
import clsx from 'clsx';
import Heading from '@theme/Heading';
import styles from './styles.module.css';

type FeatureItem = {
  title: string;
  Svg: React.ComponentType<React.ComponentProps<'svg'>>;
  description: ReactNode;
};

const FeatureList: FeatureItem[] = [
  {
    title: 'Local & Cloud AI',
    description: (
      <>
        Use local Ollama models for maximum privacy or powerful cloud providers like 
        Claude, Gemini, and Mistral for deep analysis.
      </>
    ),
  },
  {
    title: 'Seamless Integration',
    description: (
      <>
        Integrates directly into VS Code SCM, editor context menus, and gutters. 
        Get feedback exactly where you write code.
      </>
    ),
  },
  {
    title: 'Expert Quality',
    description: (
      <>
        Specialized agent skills, multi-model comparisons, and compliance profiles 
        ensure your code meets the highest standards.
      </>
    ),
  },
];

function Feature({title, description}: Omit<FeatureItem, 'Svg'>) {
  return (
    <div className={clsx('col col--4')}>
      <div className="text--center padding-horiz--md">
        <Heading as="h3">{title}</Heading>
        <p>{description}</p>
      </div>
    </div>
  );
}

export default function HomepageFeatures(): ReactNode {
  return (
    <section className={styles.features}>
      <div className="container">
        <div className="row">
          {FeatureList.map((props, idx) => (
            <Feature key={idx} {...props} />
          ))}
        </div>
      </div>
    </section>
  );
}
